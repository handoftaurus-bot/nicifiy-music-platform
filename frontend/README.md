# Current Frontend (React + Vite)

This is a production-structured frontend for your Current music app.

## Configure
Edit `.env.production`:

- `VITE_API_BASE` = https://czzz7fhbn6.execute-api.us-east-1.amazonaws.com
- `VITE_GOOGLE_CLIENT_ID` = 26760372266-rp3i6d5n95fc1rbnfan6mbpteofe94av.apps.googleusercontent.com

## Run locally
```bash
cd frontend
npm install
npm run dev
```

## Build
```bash
npm run build
```

Output goes to `frontend/dist`.

## Deploy to S3 (example)
```bash
aws s3 sync dist s3://YOUR_SITE_BUCKET --delete
aws cloudfront create-invalidation --distribution-id YOUR_DIST_ID --paths "/*"
```
