const { E2E_TESTS } = process.env;

module.exports = {
	presets: ['babel-preset-expo'],
	plugins: [
		// Support `for await () {}`
		'@babel/plugin-proposal-async-generator-functions',
		[
			'module:react-native-dotenv',
			{
				safe: true,
				allowUndefined: false,
			},
		],
		'react-native-worklets/plugin', // NOTE: this plugin MUST be last (renamed in Reanimated 4)
	],
	env: {
		production: {
			// do not use `transform-remove-console` in e2e tests
			// so we can see all the logs
			plugins: E2E_TESTS ? [] : ['transform-remove-console'],
		},
	},
};
