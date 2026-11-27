const { withPodfileProperties } = require('@expo/config-plugins');

module.exports = function withIosSourceExpoModules(config) {
  return withPodfileProperties(config, (nextConfig) => {
    nextConfig.modResults.EXPO_USE_PRECOMPILED_MODULES = 'false';
    return nextConfig;
  });
};
