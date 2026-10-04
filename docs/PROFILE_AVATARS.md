# Profile avatars and bios

Learners may choose a built-in avatar, select a square-cropped library photo, or take a camera photo. A profile photo is optional and does not change sign-in or onboarding.

## Privacy and storage

`profiles.avatar_url` is the only avatar reference. It contains either `preset:<name>` or a private `profile-avatars` object key. It never contains a device URI, data URI, arbitrary URL, or a service credential. The API converts uploaded JPEG, PNG, or WebP images to a 512px JPEG below 256 KiB, removing embedded metadata in the resulting file. The bucket is private; display links expire after two minutes.

Public-profile sharing remains private by default. The dedicated **Profile avatar** choice must be reviewed and published before a visitor receives a short-lived delivery URL. Turning that choice off removes it from future public responses immediately.

## Release operator checklist

Before merging and deploying the feature:

1. Apply migration `0040_profile_avatar_bio.sql` through the normal migration process. Do not add it to `backend/migrations/applied.txt` until production confirms it.
2. Confirm the `profile-avatars` bucket is private and its 256 KiB limit and JPEG/PNG/WebP allowlist are present.
3. Confirm Railway has `SUPABASE_SERVICE_ROLE_KEY`; it remains backend-only and must never be copied to Expo variables.
4. Build and install a new Android/iOS binary. `expo-image-picker` and its camera/photo permission messages are native configuration, so an OTA alone cannot enable photo selection on existing installs.
5. On a staging account, test each preset, denied library/camera permission, cancellation, an oversized/invalid image, photo replacement/removal, sign-out during upload, and public-avatar sharing on/off from another browser.
