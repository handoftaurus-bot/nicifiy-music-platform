terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}

provider "aws" {
  region = "us-east-1"
}

# -----------------------------
# Inputs (keep secrets out of code)
# -----------------------------
variable "raw_bucket_name" {
  type        = string
  description = "Existing raw ingest bucket name (already created)."
  default     = "nicify-raw-0238b3fd"
}

variable "google_client_id" {
  type        = string
  description = "Google OAuth Client ID for GIS (Web)."
  default     = "26760372266-rp3i6d5n95fc1rbnfan6mbpteofe94av.apps.googleusercontent.com"
}

variable "admin_email_allowlist" {
  type        = string
  description = "Comma-separated emails allowed to bootstrap admin role."
  default     = "handoftaurus@gmail.com"
}

variable "jwt_secret" {
  type        = string
  sensitive   = true
  description = "JWT signing secret used by auth_api and verified by uploads_init."
}

locals {
  project_name = "nicify"
}

resource "random_id" "suffix" {
  byte_length = 4
}

data "aws_caller_identity" "current" {}

data "aws_s3_bucket" "raw" {
  bucket = var.raw_bucket_name
}

# -----------------------------
# S3 buckets: site + audio
# -----------------------------
resource "aws_s3_bucket" "site" {
  bucket = "${local.project_name}-web-${random_id.suffix.hex}"
}

resource "aws_s3_bucket" "audio" {
  bucket = "${local.project_name}-audio-${random_id.suffix.hex}"
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket                  = aws_s3_bucket.site.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_public_access_block" "audio" {
  bucket                  = aws_s3_bucket.audio.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# -----------------------------
# CloudFront OAC
# -----------------------------
resource "aws_cloudfront_origin_access_control" "site_oac" {
  name                              = "${local.project_name}-site-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_origin_access_control" "audio_oac" {
  name                              = "${local.project_name}-audio-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# -----------------------------
# CloudFront Response Headers Policy (CORS) for audio
# -----------------------------
resource "aws_cloudfront_response_headers_policy" "audio_cors" {
  name = "${local.project_name}-audio-cors"

  cors_config {
    access_control_allow_credentials = false

    access_control_allow_headers { items = ["*"] }
    access_control_allow_methods { items = ["GET", "HEAD", "OPTIONS"] }
    access_control_allow_origins { items = ["*"] }

    origin_override = true
  }
}

resource "aws_s3_bucket_cors_configuration" "audio_cors" {
  bucket = aws_s3_bucket.audio.id

  cors_rule {
    allowed_methods = ["GET", "HEAD"]
    allowed_origins = ["*"]
    allowed_headers = ["*"]

    expose_headers = [
      "Accept-Ranges",
      "Content-Range",
      "Content-Length",
      "ETag"
    ]

    max_age_seconds = 3000
  }
}

# -----------------------------
# S3 CORS: raw uploads (browser PUT to presigned URL)
# -----------------------------
resource "aws_s3_bucket_cors_configuration" "raw_cors" {
  bucket = data.aws_s3_bucket.raw.id

  cors_rule {
    allowed_methods = ["PUT", "POST", "HEAD"]
    allowed_origins = ["https://${aws_cloudfront_distribution.site.domain_name}"]
    allowed_headers = ["*"]

    expose_headers = [
      "ETag",
      "x-amz-request-id",
      "x-amz-id-2"
    ]

    max_age_seconds = 3000
  }
}

# -----------------------------
# CloudFront for site (web UI)
# -----------------------------
resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  default_root_object = "index.html"

  origin {
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_id                = "site-origin"
    origin_access_control_id = aws_cloudfront_origin_access_control.site_oac.id
  }

  default_cache_behavior {
    target_origin_id       = "site-origin"
    viewer_protocol_policy = "redirect-to-https"

    allowed_methods = ["GET", "HEAD"]
    cached_methods  = ["GET", "HEAD"]

    compress           = true
    trusted_key_groups = []

    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

# -----------------------------
# CloudFront for audio streaming
# -----------------------------
resource "aws_cloudfront_distribution" "audio" {
  enabled = true

  origin {
    domain_name              = aws_s3_bucket.audio.bucket_regional_domain_name
    origin_id                = "audio-origin"
    origin_access_control_id = aws_cloudfront_origin_access_control.audio_oac.id
  }

  default_cache_behavior {
    target_origin_id       = "audio-origin"
    viewer_protocol_policy = "redirect-to-https"

    allowed_methods = ["GET", "HEAD", "OPTIONS"]
    cached_methods  = ["GET", "HEAD"]

    compress                   = true
    response_headers_policy_id = aws_cloudfront_response_headers_policy.audio_cors.id

    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

# -----------------------------
# Bucket policies: allow CloudFront OAC access ONLY
# -----------------------------
resource "aws_s3_bucket_policy" "site_policy" {
  bucket = aws_s3_bucket.site.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowCloudFrontReadOnlySite"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.site.arn}/*"
      Condition = {
        StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.site.arn }
      }
    }]
  })
}

resource "aws_s3_bucket_policy" "audio_policy" {
  bucket = aws_s3_bucket.audio.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowCloudFrontReadOnlyAudio"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.audio.arn}/*"
      Condition = {
        StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.audio.arn }
      }
    }]
  })
}

# -----------------------------
# DynamoDB table for tracks
# -----------------------------
resource "aws_dynamodb_table" "tracks" {
  name         = "${local.project_name}-tracks"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "track_id"

  attribute {
    name = "track_id"
    type = "S"
  }
}

# -----------------------------
# DynamoDB table for users (auth + roles + artist applications)
# -----------------------------
resource "aws_dynamodb_table" "users" {
  name         = "${local.project_name}-users"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  attribute {
    name = "gsi1pk"
    type = "S"
  }

  attribute {
    name = "gsi1sk"
    type = "S"
  }

  global_secondary_index {
    name            = "GSI1"
    hash_key        = "gsi1pk"
    range_key       = "gsi1sk"
    projection_type = "ALL"
  }
}


# -----------------------------
# IAM role & policy for Lambdas
# -----------------------------
resource "aws_iam_role" "lambda_exec" {
  name = "${local.project_name}-lambda-exec"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "lambda_policy" {
  role = aws_iam_role.lambda_exec.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:*:*:*"
      },
      {
        Effect = "Allow"
        Action = ["dynamodb:Scan", "dynamodb:Query", "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"]
        Resource = [
          aws_dynamodb_table.tracks.arn,
          aws_dynamodb_table.users.arn,
          "${aws_dynamodb_table.users.arn}/index/*"
        ]
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:ListBucket"]
        Resource = [data.aws_s3_bucket.raw.arn, "${data.aws_s3_bucket.raw.arn}/*"]
      },
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:CopyObject", "s3:ListBucket", "s3:GetObject"]
        Resource = [aws_s3_bucket.audio.arn, "${aws_s3_bucket.audio.arn}/*"]
      },
      # Allow uploads_init to PUT into raw bucket under raw/*
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:AbortMultipartUpload", "s3:ListBucketMultipartUploads", "s3:ListMultipartUploadParts"]
        Resource = ["${data.aws_s3_bucket.raw.arn}/raw/*"]
      },
      # Optional: allow listing only that prefix
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = [data.aws_s3_bucket.raw.arn]
        Condition = {
          StringLike = { "s3:prefix" = ["raw/*"] }
        }
      }
    ]
  })
}

# -----------------------------
# Lambda: GET /tracks
# -----------------------------
resource "aws_lambda_function" "tracks_api" {
  function_name = "${local.project_name}-tracks-api"
  role          = aws_iam_role.lambda_exec.arn
  handler       = "lambda_function.lambda_handler"
  runtime       = "python3.11"

  filename         = "${path.module}/../backend/tracks_api/tracks_api.zip"
  source_code_hash = filebase64sha256("${path.module}/../backend/tracks_api/tracks_api.zip")

  timeout     = 15
  memory_size = 128

  environment {
    variables = {
      TRACKS_TABLE            = aws_dynamodb_table.tracks.name
      AUDIO_CLOUDFRONT_DOMAIN = aws_cloudfront_distribution.audio.domain_name
    }
  }
}

# -----------------------------
# Lambda: GET /tracks/{track_id}/stream
# -----------------------------
resource "aws_lambda_function" "tracks_stream" {
  function_name = "${local.project_name}-tracks-stream"
  role          = aws_iam_role.lambda_exec.arn
  handler       = "lambda_function.lambda_handler"
  runtime       = "python3.11"

  filename         = "${path.module}/../backend/tracks_stream/tracks_stream.zip"
  source_code_hash = filebase64sha256("${path.module}/../backend/tracks_stream/tracks_stream.zip")

  timeout     = 15
  memory_size = 128

  environment {
    variables = {
      TRACKS_TABLE            = aws_dynamodb_table.tracks.name
      AUDIO_CLOUDFRONT_DOMAIN = aws_cloudfront_distribution.audio.domain_name
    }
  }
}

# -----------------------------
# Lambda: POST /uploads/init
# -----------------------------
resource "aws_lambda_function" "uploads_init" {
  function_name = "${local.project_name}-uploads-init"
  role          = aws_iam_role.lambda_exec.arn
  handler       = "lambda_function.lambda_handler"
  runtime       = "python3.11"

  filename         = "${path.module}/../backend/uploads_init/uploads_init.zip"
  source_code_hash = filebase64sha256("${path.module}/../backend/uploads_init/uploads_init.zip")

  timeout     = 15
  memory_size = 128

  environment {
    variables = {
      INGEST_BUCKET = data.aws_s3_bucket.raw.bucket
      JWT_SECRET    = var.jwt_secret
    }
  }
}

# -----------------------------
# Lambda layer: ffmpeg
# -----------------------------
resource "aws_lambda_layer_version" "ffmpeg" {
  layer_name          = "${local.project_name}-ffmpeg"
  filename            = "${path.module}/../ffmpeg-layer.zip"
  compatible_runtimes = ["python3.11"]
}

# -----------------------------
# Lambda: S3 ingest for raw uploads
# -----------------------------
resource "aws_lambda_function" "ingest" {
  function_name = "${local.project_name}-ingest"
  role          = aws_iam_role.lambda_exec.arn
  handler       = "lambda_function.lambda_handler"
  runtime       = "python3.11"

  filename         = "${path.module}/../backend/ingest/ingest.zip"
  source_code_hash = filebase64sha256("${path.module}/../backend/ingest/ingest.zip")
  layers           = [aws_lambda_layer_version.ffmpeg.arn]
  timeout          = 120
  memory_size      = 1024

  environment {
    variables = {
      TRACKS_TABLE = aws_dynamodb_table.tracks.name
      AUDIO_BUCKET = aws_s3_bucket.audio.bucket
    }
  }
}

resource "aws_lambda_permission" "s3_invoke_ingest" {
  statement_id  = "AllowS3InvokeIngest"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ingest.function_name
  principal     = "s3.amazonaws.com"
  source_arn    = data.aws_s3_bucket.raw.arn
}

resource "aws_s3_bucket_notification" "raw_bucket_notification" {
  bucket = data.aws_s3_bucket.raw.id

  lambda_function {
    lambda_function_arn = aws_lambda_function.ingest.arn
    events              = ["s3:ObjectCreated:*"]
  }

  depends_on = [aws_lambda_permission.s3_invoke_ingest]
}

# -----------------------------
# Lambda: Auth + roles + artist applications (Node.js)
# -----------------------------
resource "aws_lambda_function" "auth_api" {
  function_name = "${local.project_name}-auth-api"
  role          = aws_iam_role.lambda_exec.arn
  handler       = "handler.handler"
  runtime       = "nodejs22.x"

  # FIXED: match the ../backend path used by your other lambdas
  filename         = "${path.module}/../backend/auth_api/auth_api.zip"
  source_code_hash = filebase64sha256("${path.module}/../backend/auth_api/auth_api.zip")

  timeout     = 15
  memory_size = 256

  environment {
    variables = {
      GOOGLE_CLIENT_ID      = var.google_client_id
      JWT_SECRET            = var.jwt_secret
      USERS_TABLE           = aws_dynamodb_table.users.name
      ADMIN_EMAIL_ALLOWLIST = var.admin_email_allowlist
    }
  }
}

# -----------------------------
# API Gateway HTTP API
# -----------------------------
resource "aws_apigatewayv2_api" "api" {
  name          = "${local.project_name}-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = ["https://${aws_cloudfront_distribution.site.domain_name}"]
    allow_methods = ["GET", "POST", "OPTIONS"]
    allow_headers = ["*"]
  }
}

resource "aws_apigatewayv2_stage" "default_stage" {
  api_id      = aws_apigatewayv2_api.api.id
  name        = "$default"
  auto_deploy = true
}

# ---- tracks ----
resource "aws_apigatewayv2_integration" "tracks_integration" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.tracks_api.arn
  integration_method     = "POST"
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "tracks_route" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "GET /tracks"
  target    = "integrations/${aws_apigatewayv2_integration.tracks_integration.id}"
}

resource "aws_lambda_permission" "api_invoke_tracks" {
  statement_id  = "AllowAPIGatewayInvokeTracks"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.tracks_api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}

# ---- stream ----
resource "aws_apigatewayv2_integration" "tracks_stream_integration" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.tracks_stream.arn
  integration_method     = "POST"
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "tracks_stream_route" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "GET /tracks/{track_id}/stream"
  target    = "integrations/${aws_apigatewayv2_integration.tracks_stream_integration.id}"
}

resource "aws_lambda_permission" "api_invoke_tracks_stream" {
  statement_id  = "AllowAPIGatewayInvokeTracksStream"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.tracks_stream.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}

# ---- uploads/init ----
resource "aws_apigatewayv2_integration" "uploads_init_integration" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.uploads_init.arn
  integration_method     = "POST"
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "uploads_init_route" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "POST /uploads/init"
  target    = "integrations/${aws_apigatewayv2_integration.uploads_init_integration.id}"
}

resource "aws_lambda_permission" "api_invoke_uploads_init" {
  statement_id  = "AllowAPIGatewayInvokeUploadsInit"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.uploads_init.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}

# ---- auth ----
resource "aws_apigatewayv2_integration" "auth_integration" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.auth_api.arn
  integration_method     = "POST"
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "auth_google_route" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "POST /auth/google"
  target    = "integrations/${aws_apigatewayv2_integration.auth_integration.id}"
}

resource "aws_apigatewayv2_route" "me_route" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "GET /me"
  target    = "integrations/${aws_apigatewayv2_integration.auth_integration.id}"
}

resource "aws_apigatewayv2_route" "artist_apply_route" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "POST /artist/apply"
  target    = "integrations/${aws_apigatewayv2_integration.auth_integration.id}"
}

resource "aws_apigatewayv2_route" "admin_list_apps_route" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "GET /admin/artist-applications"
  target    = "integrations/${aws_apigatewayv2_integration.auth_integration.id}"
}

resource "aws_apigatewayv2_route" "admin_approve_route" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "POST /admin/artist-applications/{sub}/approve"
  target    = "integrations/${aws_apigatewayv2_integration.auth_integration.id}"
}

resource "aws_apigatewayv2_route" "admin_reject_route" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "POST /admin/artist-applications/{sub}/reject"
  target    = "integrations/${aws_apigatewayv2_integration.auth_integration.id}"
}

resource "aws_lambda_permission" "api_invoke_auth" {
  statement_id  = "AllowAPIGatewayInvokeAuth"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.auth_api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}
