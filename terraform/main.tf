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

locals {
  project_name = "nicify"
}

# Random suffix to keep bucket names unique
resource "random_id" "suffix" {
  byte_length = 4
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

resource "aws_s3_bucket" "raw" {
  bucket = "${local.project_name}-raw-${random_id.suffix.hex}"
}

# -----------------------------
# CloudFront for site (web UI)
# -----------------------------
resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  default_root_object = "index.html"

  origin {
    domain_name = aws_s3_bucket.site.bucket_regional_domain_name
    origin_id   = "site-origin"
  }

  default_cache_behavior {
    target_origin_id       = "site-origin"
    viewer_protocol_policy = "redirect-to-https"

    allowed_methods  = ["GET", "HEAD"]
    cached_methods   = ["GET", "HEAD"]

    compress = true

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
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
    domain_name = aws_s3_bucket.audio.bucket_regional_domain_name
    origin_id   = "audio-origin"
  }

  default_cache_behavior {
    target_origin_id       = "audio-origin"
    viewer_protocol_policy = "redirect-to-https"

    allowed_methods  = ["GET", "HEAD"]
    cached_methods   = ["GET", "HEAD"]

    compress = true

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
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
# IAM role & policy for Lambdas
# -----------------------------
resource "aws_iam_role" "lambda_exec" {
  name = "${local.project_name}-lambda-exec"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy" "lambda_policy" {
  role = aws_iam_role.lambda_exec.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:*:*:*"
      },
      {
        Effect = "Allow"
        Action = [
          "dynamodb:Scan",
          "dynamodb:GetItem",
          "dynamodb:PutItem"
        ]
        Resource = aws_dynamodb_table.tracks.arn
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
        ]
        Resource = [
          "${aws_s3_bucket.raw.arn}/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:CopyObject",
        ]
        Resource = [
          "${aws_s3_bucket.audio.arn}/*"
        ]
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

  environment {
    variables = {
      TRACKS_TABLE = aws_dynamodb_table.tracks.name
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

  environment {
    variables = {
      TRACKS_TABLE   = aws_dynamodb_table.tracks.name
      AUDIO_BASE_URL = "https://${aws_cloudfront_distribution.audio.domain_name}"
    }
  }
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
  layers = [aws_lambda_layer_version.ffmpeg.arn]
  timeout     = 120
  memory_size = 1024

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
  source_arn    = aws_s3_bucket.raw.arn
}
resource "aws_s3_bucket_notification" "raw_bucket_notification" {
  bucket = aws_s3_bucket.raw.id

  lambda_function {
    lambda_function_arn = aws_lambda_function.ingest.arn
    events              = ["s3:ObjectCreated:*"]
    # Add prefix filters later if needed, e.g.:
    # filter_prefix       = "uploads/"
  }

  depends_on = [aws_lambda_permission.s3_invoke_ingest]
}

resource "aws_lambda_layer_version" "ffmpeg" {
  layer_name          = "${local.project_name}-ffmpeg"
  filename            = "${path.module}/../ffmpeg-layer.zip"
  compatible_runtimes = ["python3.11"]
}

# -----------------------------
# API Gateway HTTP API
# -----------------------------
resource "aws_apigatewayv2_api" "api" {
  name          = "${local.project_name}-api"
  protocol_type = "HTTP"
}

# Integration for GET /tracks
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

# Integration for GET /tracks/{track_id}/stream
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

resource "aws_apigatewayv2_stage" "default_stage" {
  api_id      = aws_apigatewayv2_api.api.id
  name        = "$default"
  auto_deploy = true
}

# Lambda invoke permissions
resource "aws_lambda_permission" "api_invoke_tracks" {
  statement_id  = "AllowAPIGatewayInvokeTracks"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.tracks_api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}

resource "aws_lambda_permission" "api_invoke_tracks_stream" {
  statement_id  = "AllowAPIGatewayInvokeTracksStream"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.tracks_stream.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}
