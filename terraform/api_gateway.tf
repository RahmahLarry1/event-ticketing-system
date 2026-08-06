# Using HTTP API (API Gateway v2) rather than REST API (v1): same job —
# routes incoming requests to Lambda — but simpler to configure and
# noticeably cheaper per request, which matters for staying in free tier.

resource "aws_apigatewayv2_api" "api" {
  name          = "${var.project_name}-${var.environment}-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = ["*"] # tighten to your real frontend domain before going live
    allow_methods = ["GET", "POST", "DELETE"]
    allow_headers = ["content-type"]
  }
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
}

# The 4 core endpoints from Phase 2's brief — routes exist now,
# the actual logic behind each one gets written next phase.

resource "aws_apigatewayv2_route" "register" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "POST /register"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "list_events" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "GET /events"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "get_registrations" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "GET /registrations/{email}"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "cancel_registration" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "DELETE /registration/{id}"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.api.id
  name        = "$default"
  auto_deploy = true
}

# API Gateway needs explicit permission to invoke this specific Lambda
resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}
