import React, { ReactElement, useMemo } from 'react';
import { Image, StyleProp, View, ViewStyle } from 'react-native';
import { SvgXml } from 'react-native-svg';

import useColors from '../hooks/colors';
import { BasicProfile } from '../store/types/slashtags';

const faviconImage = require('../assets/favicon.png');

const ProfileImage = ({
	image,
	style,
	size = 32,
}: {
	image?: BasicProfile['image'];
	style?: StyleProp<ViewStyle>;
	size: number;
}): ReactElement => {
	const { gray5 } = useColors();

	// Support svg data urls
	const xml = useMemo(() => {
		if (image?.startsWith('data:image/svg+xml;base64,')) {
			const base64 = image.replace('data:image/svg+xml;base64,', '');
			return Buffer.from(base64, 'base64').toString();
		}
		if (image?.startsWith('data:image/svg+xml,')) {
			const encoded = image.replace('data:image/svg+xml', '');
			const decoded = decodeURIComponent(encoded);
			return decoded;
		}
	}, [image]);

	const _style: ViewStyle = useMemo(
		() => ({
			backgroundColor: xml ? 'transparent' : gray5,
			borderRadius: size,
			overflow: 'hidden',
			height: size,
			width: size,
		}),
		[xml, gray5, size],
	);

	return (
		<View style={[_style, style]}>
			{xml ? (
				<SvgXml width={size} height={size} xml={xml} />
			) : image ? (
				<Image source={{ uri: image, width: size, height: size }} />
			) : (
				<Image source={faviconImage} style={{ width: size, height: size }} />
			)}
		</View>
	);
};

export default ProfileImage;
