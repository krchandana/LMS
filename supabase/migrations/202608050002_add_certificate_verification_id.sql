-- Certificate numbers are public verification IDs and must not be reused.
create unique index if not exists certificates_certificate_number_unique_idx
  on public.certificates (certificate_number)
  where certificate_number is not null;
