const { publicConfigErrors } = require('../public-config.cjs');

const release = process.argv.includes('--release')
  || ['preview', 'production', 'production-apk'].includes(process.env.EAS_BUILD_PROFILE);
const errors = publicConfigErrors(process.env, release);

if (errors.length) {
  console.error(`Cannot publish this app:\n${errors.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log('Public app configuration is valid. No values were logged.');
}
