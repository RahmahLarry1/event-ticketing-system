# Single table holding both Events and Registrations.
#
# Item shapes:
#   Event:        PK = "EVENT#<eventId>"          SK = "EVENT#<eventId>"
#   Registration: PK = "REGISTRATION#<regId>"     SK = "REGISTRATION#<regId>"
#
# The EmailIndex GSI lets us query "all registrations for this email"
# without scanning the whole table — this is what GET /registrations/{email}
# will use in Phase 2.

resource "aws_dynamodb_table" "events_registrations" {
  name         = "${var.project_name}-${var.environment}"
  billing_mode = "PAY_PER_REQUEST" # no capacity planning needed, stays in free tier at low volume

  hash_key = "PK"
  range_key = "SK"

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  attribute {
    name = "email"
    type = "S"
  }

  global_secondary_index {
    name            = "EmailIndex"
    hash_key        = "email"
    projection_type = "ALL"
  }

  tags = {
    Project     = var.project_name
    Environment = var.environment
  }
}
