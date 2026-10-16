const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Drizzle migrations are .sql files inlined by babel-plugin-inline-import (see babel.config.js).
config.resolver.sourceExts.push('sql');

module.exports = config;
