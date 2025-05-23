const path = require('path')
const webpack = require('webpack')

const {
  parseEntry,
  getMainEntry,
  normalizePath,
  getPlatformExts,
  getPlatformCssnano,
  getPlatformStat,
  getPlatformPush,
  getPlatformUniCloud,
  createSource,
  deleteAsset,
  getDevUniConsoleCode
} = require('@dcloudio/uni-cli-shared')

const WebpackUniAppPlugin = require('../../packages/webpack-uni-app-loader/plugin/index')

const modifyVueLoader = require('../vue-loader')

const {
  createTemplateCacheLoader
} = require('../cache-loader')

function createUniMPPlugin () {
  const WebpackUniMPPlugin = require('@dcloudio/webpack-uni-mp-loader/lib/plugin/index-new')
  return new WebpackUniMPPlugin()
}

const createWxMpIndependentPlugins = require('@dcloudio/uni-mp-weixin/lib/createIndependentPlugin')

const UniTips = require('./tips')

function getProvides () {
  const uniPath = require('@dcloudio/uni-cli-shared/lib/platform').getMPRuntimePath()
  const uniCloudPath = path.resolve(__dirname, '../../packages/uni-cloud/dist/index.js')
  const provides = {
    uni: [uniPath, 'default'],
    uniCloud: [uniCloudPath, 'uniCloud']
  }

  if (process.env.UNI_USING_VUE3) {
    provides.uni = ['@dcloudio/uni-' + process.env.UNI_PLATFORM + '/dist/uni.api.esm.js', 'default']
    provides.createMiniProgramApp = [uniPath, 'createApp']
  }

  if (process.env.UNI_USING_COMPONENTS) {
    if (process.env.UNI_SUBPACKGE) {
      provides.createApp = [uniPath, 'createSubpackageApp']
    } else if (process.env.UNI_MP_PLUGIN) {
      provides.createApp = [uniPath, 'createPlugin']
    } else {
      provides.createApp = [uniPath, 'createApp']
    }
    provides.createPage = [uniPath, 'createPage']
    provides.createComponent = [uniPath, 'createComponent']
  }

  if (
    process.env.UNI_PLATFORM === 'app-plus' &&
    process.env.UNI_USING_V8
  ) {
    provides.__f__ = [path.resolve(__dirname, '../format-log.js'), 'default']

    const cryptoProvide = [path.resolve(__dirname, '../crypto.js'), 'default']
    provides.crypto = cryptoProvide
    provides['window.crypto'] = cryptoProvide
    provides['global.crypto'] = cryptoProvide
  }

  // TODO 目前依赖库 megalo 通过判断 wx 对象是否存在来识别平台做不同处理
  if (
    process.env.UNI_PLATFORM !== 'mp-qq' &&
    process.env.UNI_PLATFORM !== 'mp-weixin' &&
    process.env.UNI_PLATFORM !== 'app-plus'
  ) { // 非微信小程序，自动注入 wx 对象
    provides.wx = provides.uni
  }
  if (process.env.UNI_PLATFORM === 'mp-weixin') {
    provides.wx = [path.resolve(uniPath, '../wx.js'), 'default']
  }
  return provides
}

function processWxss (compilation, name, assets) {
  const dirname = path.dirname(name)
  const mainWxssCode = `@import "${normalizePath(path.relative(dirname, 'common/main.wxss'))}";`
  const code = `${mainWxssCode}` + assets[name].source().toString()
  compilation.updateAsset(name, createSource(code))
}

const parseRequirePath = path => path.startsWith('common') ? `./${path}` : path

function procssJs (compilation, name, assets, hasVendor) {
  const dirname = path.dirname(name)
  const runtimeJsCode = `require('${normalizePath(parseRequirePath(path.relative(dirname, 'common/runtime.js')))}');`
  const vendorJsCode = hasVendor
    ? `require('${normalizePath(parseRequirePath(path.relative(dirname, 'common/vendor.js')))}');` : ''
  const mainJsCode = `require('${normalizePath(parseRequirePath(path.relative(dirname, 'common/main.js')))}');`
  const code = `${runtimeJsCode}${vendorJsCode}${mainJsCode}` + assets[name].source().toString()
  compilation.updateAsset(name, createSource(code))
}

function processAssets (compilation) {
  const assets = compilation.assets
  const hasMainWxss = assets['common/main.wxss']
  const hasVendor = assets['common/vendor.js']
  Object.keys(assets).forEach(name => {
    if (name.startsWith('common')) {
      return
    }
    const extname = path.extname(name)
    if (extname === '.wxss' && hasMainWxss && process.UNI_ENTRY[name.replace(extname, '')]) {
      processWxss(compilation, name, assets)
    } else if (extname === '.js') {
      procssJs(compilation, name, assets, hasVendor)
    }
  })
  // delete assets['common/main.js']
  deleteAsset(compilation, 'app.js')
  deleteAsset(compilation, 'app.json')
  deleteAsset(compilation, 'app.wxss')
  deleteAsset(compilation, 'project.config.json')
}

class PreprocessAssetsPlugin {
  apply (compiler) {
    if (webpack.version[0] > 4) {
      compiler.hooks.compilation.tap('PreprocessAssetsPlugin', compilation => {
        compilation.hooks.processAssets.tap({
          name: 'PreprocessAssetsPlugin',
          stage: webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL
        }, (_) => {
          processAssets(compilation)
        })
      })
    } else {
      compiler.hooks.emit.tap('PreprocessAssetsPlugin', (compilation) => processAssets(compilation))
    }
  }
}

function initSubpackageConfig (webpackConfig, vueOptions) {
  if (process.env.UNI_OUTPUT_DEFAULT_DIR === process.env.UNI_OUTPUT_DIR) { // 未自定义output
    process.env.UNI_OUTPUT_DIR = path.resolve(process.env.UNI_OUTPUT_DIR, (process.env.UNI_SUBPACKGE || process.env
      .UNI_MP_PLUGIN))
  }
  vueOptions.outputDir = process.env.UNI_OUTPUT_DIR
  webpackConfig.output.path(process.env.UNI_OUTPUT_DIR)
  webpackConfig.output.set(webpack.version[0] > 4 ? 'chunkLoadingGlobal' : 'jsonpFunction', 'webpackJsonp_' + (process
    .env.UNI_SUBPACKGE || process.env.UNI_MP_PLUGIN))
}

function addToUniEntry (fileName) {
  fileName && (process.UNI_ENTRY[fileName.split('.')[0]] = path.resolve(process.env.UNI_INPUT_DIR, fileName))
}

module.exports = {
  vueConfig: {
    parallel: false
  },
  webpackConfig (webpackConfig, vueOptions, api) {
    if (!webpackConfig.optimization) {
      webpackConfig.optimization = {}
    }
    // disable noEmitOnErrors
    if (webpack.version[0] > 4) {
      webpackConfig.optimization.emitOnErrors = true
    } else {
      webpackConfig.optimization.noEmitOnErrors = false
    }

    webpackConfig.optimization.runtimeChunk = {
      name: 'common/runtime'
    }

    webpackConfig.optimization.splitChunks = require('../split-chunks')()

    if (webpack.version[0] > 4) {
      webpackConfig.optimization.chunkIds = 'named'
    }

    parseEntry()

    const statCode = getPlatformStat()
    const pushCode = getPlatformPush()
    const uniCloudCode = getPlatformUniCloud()

    let beforeCode = getDevUniConsoleCode() + 'import \'uni-pages\';'

    const plugins = [
      new WebpackUniAppPlugin(),
      createUniMPPlugin(),
      new webpack.ProvidePlugin(getProvides()),
      ...createWxMpIndependentPlugins()
    ]

    if ((process.env.UNI_SUBPACKGE || process.env.UNI_MP_PLUGIN) && process.env.UNI_SUBPACKGE !== 'main') {
      plugins.push(new PreprocessAssetsPlugin())
    }

    {
      const globalEnv = process.env.UNI_PLATFORM === 'mp-alipay' ? 'my' : 'wx';
      [].concat(
        process.env.UNI_MP_PLUGIN
          ? process.env.UNI_MP_PLUGIN_MAIN
          : JSON.parse(process.env.UNI_MP_PLUGIN_EXPORT)
      ).forEach(fileName => addToUniEntry(fileName))
      beforeCode += `
// @ts-ignore
${globalEnv}.__webpack_require_UNI_MP_PLUGIN__ = __webpack_require__;`
    }

    const alias = { // 仅 mp-weixin
      'mpvue-page-factory': require.resolve(
        '@dcloudio/vue-cli-plugin-uni/packages/mpvue-page-factory')
    }

    if (process.env.UNI_USING_VUE3) {
      alias.vuex = require.resolve('@dcloudio/vue-cli-plugin-uni/packages/vuex')
      alias['@vue/devtools-api'] = require.resolve('@dcloudio/vue-cli-plugin-uni/packages/@vue/devtools-api')

      alias['vue-i18n'] = require.resolve('@dcloudio/vue-cli-plugin-uni/packages/vue3/node_modules/vue-i18n')
      alias['@dcloudio/uni-app'] = require.resolve('@dcloudio/vue-cli-plugin-uni/packages/uni-app')
    }

    // 使用外层依赖的版本
    alias['regenerator-runtime'] = require.resolve('regenerator-runtime')
    const output = {
      pathinfo: true,
      filename: '[name].js',
      chunkFilename: '[id].js',
      globalObject: process.env.UNI_PLATFORM === 'mp-alipay' ? 'my' : 'global'
      // sourceMapFilename: '../.sourcemap/' + process.env.UNI_PLATFORM + '/[name].js.map'
    }
    if (process.env.NODE_ENV === 'production' || process.env.UNI_MINIMIZE === 'true') {
      output.pathinfo = false
    }

    if (process.env.UNI_PLATFORM === 'mp-weixin' && process.env.NODE_ENV === 'production') {
      plugins.push(new UniTips())
    }

    return {
      mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
      entry () {
        return process.UNI_ENTRY
      },
      output,
      performance: {
        hints: false
      },
      resolve: {
        extensions: ['.uts', '.nvue'],
        alias
      },
      module: {
        rules: [{
          test: path.resolve(process.env.UNI_INPUT_DIR, getMainEntry()),
          use: [{
            loader: path.resolve(__dirname, '../../packages/wrap-loader'),
            options: {
              before: [
                beforeCode + require('../util').getAutomatorCode() + statCode + pushCode + uniCloudCode
              ]
            }
          }, {
            loader: '@dcloudio/webpack-uni-mp-loader/lib/main'
          }]
        }, {
          resourceQuery: /vue&type=script/,
          use: [{
            loader: '@dcloudio/webpack-uni-mp-loader/lib/script'
          }]
        }, {
          resourceQuery: /vue&type=template/,
          use: [{
            loader: '@dcloudio/webpack-uni-mp-loader/lib/template'
          }, {
            loader: '@dcloudio/vue-cli-plugin-uni/packages/webpack-uni-app-loader/page-meta'
          }]
        }, createTemplateCacheLoader(api), {
          resourceQuery: [
            /lang=wxs/,
            /lang=filter/,
            /lang=sjs/,
            /blockType=wxs/,
            /blockType=filter/,
            /blockType=sjs/
          ],
          use: [{
            loader: require.resolve(
              '@dcloudio/vue-cli-plugin-uni/packages/webpack-uni-filter-loader')
          }]
        }]
      },
      plugins
    }
  },
  chainWebpack (webpackConfig, vueOptions, api) {
    if (process.env.UNI_PLATFORM === 'mp-baidu') {
      webpackConfig.module
        .rule('js')
        .exclude
        .add(/\.filter\.js$/)
    }

    const compilerOptions = process.env.UNI_USING_COMPONENTS ? {} : require('../mp-compiler-options')

    modifyVueLoader(webpackConfig, {}, compilerOptions, api)

    const styleExt = getPlatformExts().style

    webpackConfig.plugin('extract-css')
      .init((Plugin, args) => new Plugin({
        filename: '[name]' + styleExt
      }))

    if (
      process.env.NODE_ENV === 'production' &&
      process.env.UNI_PLATFORM !== 'app-plus'
    ) {
      // webpack5 不再使用 OptimizeCssnanoPlugin，改用 CssMinimizerPlugin
      if (webpack.version[0] > 4) {
        webpackConfig.optimization.minimizer('css').tap(args => {
          args[0].test = new RegExp(`\\${styleExt}$`)
          return args
        })
      } else {
        const OptimizeCssnanoPlugin = require('../../packages/@intervolga/optimize-cssnano-plugin/index.js')
        webpackConfig.plugin('optimize-css')
          .init((Plugin, args) => new OptimizeCssnanoPlugin({
            sourceMap: false,
            filter (assetName) {
              return path.extname(assetName) === styleExt
            },
            cssnanoOptions: {
              preset: [
                'default',
                Object.assign({}, getPlatformCssnano(), {
                  discardComments: true
                })
              ]
            }
          }))
      }
    }

    if (process.env.NODE_ENV === 'production' && webpack.version[0] > 4) {
      // 暂时禁用，否则导致 provide 被压缩和裁剪
      webpackConfig.optimization.usedExports(false)
    }

    if (process.env.UNI_SUBPACKGE || process.env.UNI_MP_PLUGIN) {
      initSubpackageConfig(webpackConfig, vueOptions)
    }

    webpackConfig.plugins.delete('hmr')
    webpackConfig.plugins.delete('html')
    webpackConfig.plugins.delete('copy')
    webpackConfig.plugins.delete('preload')
    webpackConfig.plugins.delete('prefetch')
  }
}
