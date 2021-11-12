import cdk = require('@aws-cdk/core');
import { CdkUnleash } from "../lib";

class TestStack extends cdk.Stack {
    constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
        super(scope, id, props);
        const zone = new CdkUnleash(this, `cdk-unleash`, {
            // Overriding rds properties
            rds: {
                dbName: "unleashDb",
                removalPolicy: cdk.RemovalPolicy.SNAPSHOT
            },
            // Overriding ecs properties
            ecsService: {
                minimumTaskCount: 2,
                maximumTaskCount: 10,
            },
            // ... visit index.ts or autocomplete for more properties
        });
    }
}

const app = new cdk.App();
cdk.Tags.of(app).add('project', 'test_unleash');

new TestStack(app, 'TestStack');

app.synth();
