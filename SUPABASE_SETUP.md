# Supabase Setup

## 1. Create the table
Run the SQL in [supabase/schema.sql](/Users/ishan/Desktop/dropamyn-landing/supabase/schema.sql) inside your Supabase SQL editor.

## 2. Add Vercel environment variables
Add these in your Vercel project settings:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Use the project URL and the service role key from your Supabase project.

## 3. What gets stored
Each signup saves:

- `email`
- `priority_tier`
- `signup_source`
- `joined_from`
- `user_agent`
- `created_at`

## 4. Priority tiers
The API assigns users into these buckets:

- `founding`: first 250 signups
- `priority`: next 750 signups
- `waitlist`: everyone after that

You can change those thresholds later in [api/signup.js](/Users/ishan/Desktop/dropamyn-landing/api/signup.js).
