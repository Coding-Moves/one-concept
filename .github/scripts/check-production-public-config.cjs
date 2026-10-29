// The release gate must not publish an OTA that still targets Railway or a
// different Supabase project after the production Edge deployment succeeded.
const PROJECT_URL = 'https://egdszjoesxlccauahmsx.supabase.co';

function productionConfigReady(env) {
  return env.EXPO_PUBLIC_API_BASE_URL === `${PROJECT_URL}/functions/v1/api`
    && env.EXPO_PUBLIC_SUPABASE_URL === PROJECT_URL;
}

if (require.main === module) {
  if (!productionConfigReady(process.env)) {
    console.error('Production OTA requires the reviewed Supabase API and Auth project.');
    process.exitCode = 1;
  } else {
    console.log('Production API and Auth project verified. No values were logged.');
  }
}

module.exports = { productionConfigReady };
