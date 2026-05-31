-- Scheduled cleanup: delete media files older than 48 hours
-- Schedule this as a pg_cron job or Supabase Edge Function cron

-- Enable pg_cron extension (run once as superuser):
-- CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Cleanup function
CREATE OR REPLACE FUNCTION cleanup_old_media()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  cutoff TIMESTAMPTZ := now() - INTERVAL '48 hours';
  media_rec RECORD;
  obj_name TEXT;
BEGIN
  -- Collect file names to delete from storage
  -- broadcast_media older than 48h
  FOR media_rec IN
    SELECT storage_url, thumbnail_url FROM broadcast_media WHERE created_at < cutoff
  LOOP
    -- Extract file name from URL
    obj_name := regexp_replace(media_rec.storage_url, '.*/media/', '');
    PERFORM storage.delete_object('media', obj_name);

    IF media_rec.thumbnail_url IS NOT NULL AND media_rec.thumbnail_url != media_rec.storage_url THEN
      obj_name := regexp_replace(media_rec.thumbnail_url, '.*/media/', '');
      PERFORM storage.delete_object('media', obj_name);
    END IF;
  END LOOP;

  -- message_media older than 48h
  FOR media_rec IN
    SELECT storage_url, thumbnail_url FROM message_media WHERE created_at < cutoff
  LOOP
    obj_name := regexp_replace(media_rec.storage_url, '.*/media/', '');
    PERFORM storage.delete_object('media', obj_name);

    IF media_rec.thumbnail_url IS NOT NULL AND media_rec.thumbnail_url != media_rec.storage_url THEN
      obj_name := regexp_replace(media_rec.thumbnail_url, '.*/media/', '');
      PERFORM storage.delete_object('media', obj_name);
    END IF;
  END LOOP;

  -- Delete DB rows (keep text content, so DO NOT delete broadcasts/messages)
  DELETE FROM broadcast_media WHERE created_at < cutoff;
  DELETE FROM message_media WHERE created_at < cutoff;

  RAISE NOTICE 'Media cleanup completed at %', now();
END;
$$;

-- Schedule to run every 6 hours (requires pg_cron):
SELECT cron.schedule(
  'cleanup-media-every-6h',
  '0 */6 * * *',
  'SELECT cleanup_old_media()'
);
