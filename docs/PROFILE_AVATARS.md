# Profile avatars and bios

Learners may choose a built-in avatar, select a library photo, or take a camera photo. The app shows a centered-square preview with an explicit **Save photo** or **Cancel photo change** action. The server applies that centered crop when it normalizes the image. A profile photo is optional and does not change sign-in or onboarding.

## Privacy and storage

`profiles.avatar_url` is the only avatar reference. It contains either `preset:<name>` or a private `profile-avatars` object key. It never contains a device URI, data URI, arbitrary URL, or a service credential. The API converts uploaded JPEG, PNG, or WebP images to a 512px JPEG below 256 KiB, removing embedded metadata in the resulting file. The bucket is private; display links expire after two minutes.

The photo picker stores only the initiating account ID until it returns. Sign-out clears that marker; a result recovered after Android activity recreation appears as a preview only for the initiating account. The selected photo stays in memory until Save or Cancel, and an upload failure preserves the last confirmed avatar for retry.

Public-profile sharing remains private by default. The dedicated **Profile avatar** choice must be reviewed and published before a visitor receives a short-lived delivery URL. Turning that choice off removes it from future public responses immediately.

## Release operator checklist

Before merging and deploying the feature:

1. Apply migration `0040_profile_avatar_bio.sql` through the normal migration process. Do not add it to `backend/migrations/applied.txt` until production confirms it.
2. In Supabase Storage, create `profile-avatars` as a **private** bucket with a 256 KiB file limit and JPEG/PNG/WebP allowlist. Storage buckets are managed by Supabase Storage, not the application PostgreSQL migration runner.
3. Confirm Railway has `SUPABASE_SERVICE_ROLE_KEY`; it remains backend-only and must never be copied to Expo variables.
4. Build and install a new Android/iOS binary. `expo-image-picker` and its camera/photo permission messages are native configuration, so an OTA alone cannot enable photo selection on existing installs.
5. On a staging account, test each preset, denied library/camera permission, picker cancellation, preview Save/Cancel, an oversized/invalid image, photo replacement/removal, sign-out during picker or upload, and public-avatar sharing on/off from another browser. Check the Android activity-recreation path on a physical device; web tests do not prove native picker behavior.
