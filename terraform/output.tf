output "site_bucket_name" {
  value = aws_s3_bucket.site.bucket
}

output "cloudfront_site_url" {
  value = "https://${aws_cloudfront_distribution.site.domain_name}"
}

output "audio_bucket_name" {
  value = aws_s3_bucket.audio.bucket
}

output "cloudfront_audio_url" {
  value = "https://${aws_cloudfront_distribution.audio.domain_name}"
}

output "api_url" {
  value = aws_apigatewayv2_api.api.api_endpoint
}

