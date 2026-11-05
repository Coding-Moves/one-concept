const fs = require('node:fs');
const { resolve } = require('node:path');

const stagingProfiles = new Set(['preview', 'staging-development']);

function stagingGoogleServicesErrors(file) {
  if (!file) return ['Staging Firebase file is missing'];
  try {
    const config = JSON.parse(fs.readFileSync(resolve(file), 'utf8'));
    const packages = config.client?.map(client => client.client_info?.android_client_info?.package_name) ?? [];
    return packages.includes('com.codingmoves.oneconcept.staging')
      ? [] : ['Staging Firebase file does not register the staging Android package'];
  } catch {
    return ['Staging Firebase file cannot be read'];
  }
}

if (require.main === module && stagingProfiles.has(process.env.EAS_BUILD_PROFILE)) {
  const file = process.env.STAGING_GOOGLE_SERVICES_FILE || './google-services.staging.json';
  const errors = stagingGoogleServicesErrors(file);
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else {
    console.log('Staging Firebase package verified. No values were logged.');
  }
}

module.exports = { stagingGoogleServicesErrors };
