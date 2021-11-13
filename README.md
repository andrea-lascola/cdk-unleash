# CDK Contruct for Unleash feature flags

CDK Contruct library that allows you to deploy [Unleash feature-flags](https://www.getunleash.io/) on AWS without effort.

Please visit https://www.getunleash.io/open-source if you are interested in the open source version of the software

# Installation

```bash
npm i cdk-unleash
```
https://www.npmjs.com/package/cdk-unleash

# Sample
Here you can find samples, please head to example folder for more details


## Simple
```ts
import { CdkUnleash } from 'cdk-unleash';

const app = new cdk.App();

const env = {
  region: process.env.CDK_DEFAULT_REGION,
  account: process.env.CDK_DEFAULT_ACCOUNT,
};

const stack = new cdk.Stack(app, 'unleash-stack', { env });

new CdkUnleash(stack, `unleash`);
// A set of default are applied (please visit the #Defaults section)
// After deploy, unleash will be available using the public Alb address (see outputs)
```


## Properties Override
Almost every property is overridable, in this example I specified RETAIN for removal policy and changed ecs container numbers
```ts
import { CdkUnleash } from 'cdk-unleash';

const app = new cdk.App();

const env = {
  region: process.env.CDK_DEFAULT_REGION,
  account: process.env.CDK_DEFAULT_ACCOUNT,
};

const stack = new cdk.Stack(app, 'unleash-stack', { env });

new CdkUnleash(stack, `unleash`, {
    // Overriding rds properties
    rds: {
        dbName: "unleashDb",
        removalPolicy: cdk.RemovalPolicy.RETAIN
    },
    // Overriding ecs properties
    ecsService: {
        minimumTaskCount: 2,
        maximumTaskCount: 10,
    }
});
```

## Custom domain and https
```ts
import * as route53 from '@aws-cdk/aws-route53';
import { CdkUnleash } from 'cdk-unleash';

const app = new cdk.App();

const env = {
  region: process.env.CDK_DEFAULT_REGION,
  account: process.env.CDK_DEFAULT_ACCOUNT,
};

const stack = new cdk.Stack(app, 'unleash-stack', { env });

new CdkUnleash(stack, `unleash`, {
    domain: {
        certificateArn: '<your-certificate-acm-arn>',
        domainName: 'subdomain.yourdomain.com',
        hostedZone: route53.HostedZone.fromHostedZoneAttributes(stack, 'HostedZone', {
            hostedZoneId: 'HOSTEDZONEID',
            zoneName: 'yourdomain.com'
        }),
    }
});
```


# Defaults

A set of decisions are applied to ensure the construct is usable without too many tweaking, here are the current construct defaults:

## VPC
* Subnetting
    * DB is in an `isolated subnet`
    * ECS is in a `private_with_nat subnet`
    * ALB is in a `public subnet`

## RDS
* Cluster
    * db engine is `aurora postgres` (the engine supported by unleash)
    * storage is `encrypted` by default
* Backups
    * backups are `performed every day` in a window: 01:00-02:00
    * backups `retention period` is 30 days
* Instances
    * instance `size` is the smaller possible for postgres (tg4-medium), instanceProps can be passed to opt for a different sizing

## ECS
* Service
    * service default `count` is 1 (to reduce costs), can be changed
    * autoscaling is supported, just pass a (>1) _maximumTaskCount_
    * autoscaling happens on `CPU usage`: > 60%
* Logs
    * logs enabled by default with a standard logDriver
    * logs retention period is 30 days


Please head to lib/index.ts for the updated list of default applied.




You should explore the contents of this project. It demonstrates a CDK Construct Library that includes a construct (`CdkUnleash`)
which contains an Amazon SQS queue that is subscribed to an Amazon SNS topic.

The construct defines an interface (`CdkUnleashProps`) to configure the visibility timeout of the queue.

## Useful commands

 * `npm run build`   compile typescript to js

## LICENSE
This project is licensed under the Apache-2.0 License.

