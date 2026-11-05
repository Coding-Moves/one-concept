const { publicConfigErrors } = require('../public-config.cjs');

const release = process.argv.includes('--release')
  || ['development', 'preview', 'staging-development', 'production', 'production-apk'].includes(process.env.EAS_BUILD_PROFILE);
const requestedVariant = process.argv.find(arg => arg.startsWith('--variant='))?.split('=')[1];
const profileVariant = ['development', 'preview', 'staging-development'].includes(process.env.EAS_BUILD_PROFILE) ? 'staging'
  : ['production', 'production-apk'].includes(process.env.EAS_BUILD_PROFILE) ? 'production' : null;
const variant = requestedVariant || profileVariant || process.env.APP_VARIANT;
const errors = publicConfigErrors(process.env, release, variant);
if (release && !variant) errors.push('APP_VARIANT must explicitly identify staging or production');
if (release && process.env.APP_VARIANT !== variant) errors.push('APP_VARIANT must match the requested publication variant');
if (profileVariant && variant !== profileVariant) errors.push('EAS_BUILD_PROFILE and APP_VARIANT do not match');

if (errors.length) {
  console.error(`Cannot publish this app:\n${errors.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log('Public app configuration is valid. No values were logged.');
}
