variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Used as a prefix for naming every resource, so they're easy to find and tear down"
  type        = string
  default     = "event-ticketing"
}

variable "environment" {
  description = "Deployment environment name (dev, staging, prod)"
  type        = string
  default     = "dev"
}
variable "alert_email" {
  description = "Email address to receive CloudWatch alarm and SNS notifications"
  type        = string
}