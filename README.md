# Event Registration & Ticketing System — Phase 1: Infrastructure Foundation

This phase creates every piece of AWS infrastructure the API needs, wired
together but not yet doing real business logic — that's Phase 2. Running
`terraform apply` right now gives you a live, working (if minimal) endpoint.

## What's in this folder

```
terraform/
  main.tf          provider setup
  variables.tf      project name, environment, region
  dynamodb.tf       the single table + email GSI
  iam.tf            least-privilege execution role for Lambda
  lambda.tf         the Lambda function itself, zipped from src/
  api_gateway.tf     HTTP API with all 4 routes wired to the Lambda
  outputs.tf        prints the API URL and table name after apply
src/
  handler.js        placeholder logic — proves the wiring works end to end
```

## Why these specific choices

- **DynamoDB single table** — one table (`PK`/`SK`) holding both events and
  registrations, plus an `EmailIndex` GSI. This is the AWS-recommended
  pattern for serverless apps: fewer tables to provision and pay for, one
  query path by ID and one by email.
- **HTTP API, not REST API** — same job (route requests to Lambda), but
  cheaper per request and simpler to configure. Worth mentioning in your
  presentation as a deliberate cost/complexity trade-off, not an oversight.
- **One Lambda function for all 4 routes** — API Gateway passes the route
  key (`event.routeKey` in the handler) so one function can branch to the
  right logic. Fewer functions to manage, and Phase 2 becomes "add an if
  branch" rather than "provision a new function."
- **Least privilege IAM** — the Lambda's role can only read/write/query the
  one DynamoDB table it needs, and only write CloudWatch logs. It cannot
  touch any other AWS resource in your account.

## How to run it

You'll need the AWS CLI configured (`aws configure`) with credentials that
have permission to create these resources, and Terraform installed.

```bash
cd terraform
terraform init
terraform plan     # review what will be created before committing
terraform apply    # type "yes" when prompted
```

After apply finishes, copy the `api_endpoint` output and test it:

```bash
curl https://<api_endpoint>/events
```

You should get back the placeholder JSON response — that confirms API
Gateway → Lambda → (eventually) DynamoDB is wired correctly end to end.

## Tearing down

Since this is a portfolio/learning project, don't leave it running when
you're not actively working on it — DynamoDB and Lambda are free-tier
friendly but not free forever:

```bash
terraform destroy
```

## Checklist against the brief

- [x] Research cloud infrastructure services for static hosting *(HTTP API + Lambda chosen over static hosting — this app needs compute, not just files)*
- [x] Investigate serverless compute options → Lambda
- [x] Learn about API Gateway and its role → HTTP API routes requests to Lambda
- [x] Understand IAM in AWS → least-privilege role in `iam.tf`
- [x] Design a resource template that creates all necessary infrastructure → this Terraform project

## Next: Phase 2

`src/handler.js` currently just proves the wiring works. Phase 2 replaces
it with real logic for all 4 routes, backed by the DynamoDB table already
provisioned here.
