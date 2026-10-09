-- Domain tables created after the phase 1–4 lockdown were left open to
-- Supabase Data API roles. Posts were revoked earlier but never had RLS.
-- Same rule as phase 1: RLS on, no policies, no client grants.
-- Nest/Prisma uses the table owner, which bypasses RLS. Do not FORCE RLS.

REVOKE ALL ON TABLE public.payments FROM anon, authenticated;
REVOKE ALL ON TABLE public.invoices FROM anon, authenticated;
REVOKE ALL ON TABLE public.work_request_attachments FROM anon, authenticated;
REVOKE ALL ON TABLE public.engagement_review_media FROM anon, authenticated;

REVOKE ALL ON TABLE public.posts FROM anon, authenticated;
REVOKE ALL ON TABLE public.post_media FROM anon, authenticated;
REVOKE ALL ON TABLE public.post_likes FROM anon, authenticated;
REVOKE ALL ON TABLE public.post_comments FROM anon, authenticated;
REVOKE ALL ON TABLE public.post_saves FROM anon, authenticated;

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_request_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_review_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_saves ENABLE ROW LEVEL SECURITY;

-- New tables created by this role should not inherit Supabase's default
-- grants to the Data API roles.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

COMMENT ON TABLE public.payments IS
  'Domain table owned by NestJS/Prisma. RLS on, no PostgREST policies.';
COMMENT ON TABLE public.invoices IS
  'Domain table owned by NestJS/Prisma. RLS on, no PostgREST policies.';
COMMENT ON TABLE public.work_request_attachments IS
  'Domain table owned by NestJS/Prisma. RLS on, no PostgREST policies.';
COMMENT ON TABLE public.engagement_review_media IS
  'Domain table owned by NestJS/Prisma. RLS on, no PostgREST policies.';
