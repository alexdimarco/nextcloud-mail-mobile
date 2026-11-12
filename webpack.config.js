/**
 * SPDX-FileCopyrightText: 2018 Nextcloud GmbH and Nextcloud contributors
 * SPDX-FileCopyrightText: 2026 Alex DiMarco
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Adapted from the Nextcloud Mail app's webpack.common.js

const fs = require('fs')
const path = require('path')
const { VueLoaderPlugin } = require('vue-loader')
const webpack = require('webpack')

const appVersion = require('./package.json').version

const MAIN = 'mail_mobile-main'

// Writes js/mobile-manifest.json with the current file name of the main
// bundle. That name carries a hash of its content, so every build gets a
// new address and no cache (browser, home-screen app, proxy) can keep an
// old copy. templates/main.php is told the name by PageController.
const bundleManifestPlugin = {
	apply(compiler) {
		compiler.hooks.afterEmit.tapAsync('MobileManifestPlugin', (compilation, callback) => {
			const byChunk = compilation.getStats().toJson({ assets: true }).assetsByChunkName || {}
			const assets = byChunk[MAIN] || []
			const jsFile = (Array.isArray(assets) ? assets : [assets]).find((file) => file.endsWith('.js'))
			if (jsFile) {
				fs.writeFileSync(
					path.join(compiler.options.output.path, 'mobile-manifest.json'),
					JSON.stringify({ main: jsFile }) + '\n',
				)
			}
			callback()
		})
	},
}

module.exports = (env, argv) => ({
	mode: argv.mode === 'development' ? 'development' : 'production',
	devtool: argv.mode === 'development' ? 'cheap-source-map' : false,
	entry: {
		[MAIN]: path.join(__dirname, 'src/main.js'),
		'mail_mobile-sw': path.join(__dirname, 'src/sw.js'),
		'mail_mobile-reauth': path.join(__dirname, 'src/reauth.js'),
	},
	output: {
		path: path.resolve(__dirname, 'js'),
		filename: (pathData) => (pathData.chunk.name === MAIN ? '[name].[contenthash:12].js' : '[name].js'),
		chunkFilename: 'mail_mobile-[name].[contenthash:12].js',
		clean: true,
	},
	module: {
		rules: [
			{
				test: /\.css$/,
				use: ['style-loader', 'css-loader'],
			},
			{
				test: /\.vue$/,
				loader: 'vue-loader',
			},
		],
	},
	plugins: [
		new VueLoaderPlugin(),
		new webpack.DefinePlugin({
			appName: JSON.stringify('mail_mobile'),
			appVersion: JSON.stringify(appVersion),
		}),
		bundleManifestPlugin,
	],
	resolve: {
		extensions: ['.js', '.vue'],
	},
	performance: {
		hints: false,
	},
})
