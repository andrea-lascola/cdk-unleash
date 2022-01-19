import * as cdk from '@aws-cdk/core';
import * as ecs_patterns from '@aws-cdk/aws-ecs-patterns';
import * as rds from '@aws-cdk/aws-rds';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as ecs from '@aws-cdk/aws-ecs';
import * as acm from '@aws-cdk/aws-certificatemanager';
import * as route53 from '@aws-cdk/aws-route53';
import * as secrets from '@aws-cdk/aws-secretsmanager';
import {RetentionDays} from '@aws-cdk/aws-logs';

export interface CdkUnleashProps {
    /**
     * Existing Vpc
     */
    existingVpc?: ec2.Vpc
    rds?: {
        /**
         * Database name
         *
         * @default - "unleash_db"
         */
        dbName?: string
        /**
         * Database removal policy
         *
         * @default - cdk.RemovalPolicy.SNAPSHOT (perform a last snapshot before removal)
         */
        removalPolicy?: cdk.RemovalPolicy
        /**
         * Instance props override for rds
         *
         * @default - a standard set of properties
         */
        instanceProps?: rds.InstanceProps

        /**
         * Database backup props
         *
         * @default - a standard set of properties:
         * - backups is done during the night in the following hours: '01:00-02:00'
         * - backups are stored for a period of 30 days
         */
        backup?: rds.BackupProps
    }
    imageOptions?: {
        /**
         * Task image Log driver
         */
        logDriver?: ecs.LogDriver
    }
    ecsService?: {
        /**
         * Minimum number of ECS tasks after deploying and when scaling in
         *
         * @default - 1
         */
        minimumTaskCount?: number
        /**
         * Maximum number of ECS tasks when scaling out
         *
         * @default - 5
         */
        maximumTaskCount?: number
        /**
         * Cpu percentage for which to scale out ecs task
         *
         * @default - 60 -> 60%
         */
        scaleOnCpuPercentage?: number,
        /**
         * Length of time to wait before scale-in process occour
         *
         * @default cdk.Duration.seconds(60)
         */
        scaleInCooldown?: cdk.Duration
        /**
         * Length of time to wait before scale-out process occour
         *
         * @default cdk.Duration.seconds(60)
         */
        scaleOutCooldown?: cdk.Duration
    }
    domain?: {
        /**
         * Certificate Manager certificate to associate with the load balancer.
         *
         * @default - No certificate set
         */
        certificateArn: string
        /**
         * The Route53 hosted zone for the domain, e.g. "example.com.".
         *
         * @default - No Route53 hosted domain zone.
         */
        hostedZone: route53.IHostedZone
        /**
         * The Route53 hosted zone for the domain, e.g. "example.com.".
         *
         * @default - No Route53 hosted domain zone.
         */
        domainName: string
    }
}

export class CdkUnleash extends cdk.Construct {


    public vpc: ec2.Vpc;
    public dbSubnetGroup: rds.SubnetGroup;
    public secret: secrets.Secret;
    public loadBalancedService: ecs_patterns.ApplicationLoadBalancedFargateService;
    public ecsCluster: ecs.Cluster;
    public dbCluster: rds.DatabaseCluster;
    public dbClusterSecurityGroup: ec2.SecurityGroup;

    constructor(scope: cdk.Construct, id: string, props: CdkUnleashProps) {
        super(scope, id);

        const vpcCidr = '10.0.0.0/16'
        const databasePort = 5432;
        /**
         * Create a Vpc with a predefined set of subnets(vpc can also be passed as props.existingVpc) :
         * - PUBLIC for load balancer
         * - PRIVATE W/ NAT gateway for ECS tasks
         * - PRIVATE ISOLATED for rds database
         */
        this.vpc = props.existingVpc || new ec2.Vpc(this, 'Vpc', {
            cidr: vpcCidr,
            natGateways: 1,
            subnetConfiguration: [
                {name: 'elb_public_', subnetType: ec2.SubnetType.PUBLIC},
                {name: 'ecs_private_', subnetType: ec2.SubnetType.PRIVATE_WITH_NAT},
                {name: 'rds_isolated_', subnetType: ec2.SubnetType.PRIVATE_ISOLATED}
            ]
        });

        this.dbSubnetGroup = new rds.SubnetGroup(this, 'AuroraSubnetGroup', {
            vpc: this.vpc,
            vpcSubnets: {subnetGroupName: "rds_isolated_"},
            subnetGroupName: 'db-subnet-group',
            description: 'Subnet group to access db'
        });

        this.secret = new secrets.Secret(this, 'DbPassword', {
            secretName: '/' + ['unleash', 'db-password'].join('/'),
            generateSecretString: {
                secretStringTemplate: JSON.stringify({
                    username: 'postgres',
                }),
                excludePunctuation: true,
                includeSpace: false,
                generateStringKey: 'password'
            }
        })

        /**
         * Db cluster setup
         * Unleash require a Postgres database, instance props can be overwritten with props.rds.instanceProps
         */
        this.dbClusterSecurityGroup = new ec2.SecurityGroup(this, 'DBSecurityGroup', {vpc: this.vpc});
        this.dbClusterSecurityGroup.addIngressRule(ec2.Peer.ipv4(vpcCidr), ec2.Port.tcp(5432));

        this.dbCluster = new rds.DatabaseCluster(this, 'Database', {
            removalPolicy: props.rds?.removalPolicy || cdk.RemovalPolicy.SNAPSHOT,
            defaultDatabaseName: props.rds?.dbName || "unleash_db",
            engine: rds.DatabaseClusterEngine.auroraPostgres({
                version: rds.AuroraPostgresEngineVersion.VER_13_3
            }),
            credentials: rds.Credentials.fromSecret(this.secret),
            instanceProps: props.rds?.instanceProps || {
                instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MEDIUM),
                vpcSubnets: {
                    subnetGroupName: "rds_isolated_",
                },
                vpc: this.vpc,
                securityGroups: [this.dbClusterSecurityGroup],
            },
            subnetGroup: this.dbSubnetGroup,
            port: databasePort,
            storageEncrypted: true,
            backup: props.rds?.backup || {
                retention: cdk.Duration.days(30),
                preferredWindow: '01:00-02:00'
            }
        });

        /**
         * ECS Application Load balanced service with the unleash Docker image, provide:
         * - autoscaling on CPU
         * - logging w/ cloudwatch logs
         */
        this.ecsCluster = new ecs.Cluster(this, 'EcsCluster', {vpc: this.vpc});
        this.loadBalancedService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, "FargateService", {
            cluster: this.ecsCluster,
            desiredCount: props.ecsService?.minimumTaskCount || 1,
            taskImageOptions: {
                logDriver: props.imageOptions?.logDriver || ecs.LogDriver.awsLogs({
                    streamPrefix: `unleash_web_log`,
                    logRetention: RetentionDays.ONE_MONTH
                }),
                image: ecs.ContainerImage.fromAsset(__dirname + "/../docker-unleash-web"),
                environment: {
                    DATABASE_HOST: this.dbCluster.clusterEndpoint.hostname,
                    DATABASE_NAME: props.rds?.dbName || "unleash_db",
                    DATABASE_USERNAME: this.secret.secretValueFromJson('username').toString(),
                    DATABASE_PASSWORD: this.secret.secretValueFromJson('password').toString(),
                    DATABASE_SSL: 'false'
                },
                containerPort: 4242,
                enableLogging: true,
            },
            certificate: props.domain?.certificateArn ? acm.Certificate.fromCertificateArn(this, `certificateArn`, props.domain?.certificateArn) : undefined,
            listenerPort: props.domain ? 443 : undefined,
            domainZone: props.domain?.hostedZone,
            domainName: props.domain?.domainName,
        });
        const autoScalingGroup = this.loadBalancedService.service.autoScaleTaskCount({
            minCapacity: props.ecsService?.minimumTaskCount || 1,
            maxCapacity: props.ecsService?.maximumTaskCount || 1
        });
        autoScalingGroup.scaleOnCpuUtilization(`ScaleEcsOnCPU`, {
            targetUtilizationPercent: props.ecsService?.scaleOnCpuPercentage || 60,
            scaleInCooldown: props.ecsService?.scaleInCooldown || cdk.Duration.seconds(60),
            scaleOutCooldown: props.ecsService?.scaleOutCooldown || cdk.Duration.seconds(60),
        })

        // Allow connections from service to dbCluster
        this.dbCluster.connections.allowFrom(this.loadBalancedService.service, ec2.Port.tcp(databasePort))

        new cdk.CfnOutput(this, `AlbEndpoint`, {
            value: this.loadBalancedService.loadBalancer.loadBalancerDnsName,
            exportName: 'alb-endpoint'
        })
    }
}
