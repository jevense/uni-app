"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

function getDefaultSassImplementation() {
  if (process.env.UNI_SASS_IMPLEMENTATION_NAME === 'dart-sass') {
    if (require('@dcloudio/uni-cli-shared').isInHBuilderX) {
      return require('sass');
    }
  }
  let sassImplPkg = 'node-sass';

  try {
    require.resolve('node-sass');
  } catch (error) {
    try {
      require.resolve('sass');

      sassImplPkg = 'sass';
    } catch (ignoreError) {
      sassImplPkg = 'node-sass';
    }
  } // eslint-disable-next-line import/no-dynamic-require, global-require


  return require(sassImplPkg);
}

var _default = getDefaultSassImplementation;
exports.default = _default;
