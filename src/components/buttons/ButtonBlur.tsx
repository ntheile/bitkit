import { BlurView } from '@react-native-community/blur';
import React, { ReactElement } from 'react';
import {
	Platform,
	Pressable,
	StyleProp,
	StyleSheet,
	View,
	ViewStyle,
} from 'react-native';
import { SvgXml } from 'react-native-svg';
import { BodySSB } from '../../styles/text';

const ButtonBlur = ({
	text,
	icon,
	style,
	testID,
	onPress,
	borderRadius,
}: {
	text: string;
	icon?: string;
	style?: StyleProp<ViewStyle>;
	testID?: string;
	onPress?: () => void;
	borderRadius?: number | { topLeft?: number; topRight?: number; bottomLeft?: number; bottomRight?: number };
}): ReactElement => {
	const containerBorderRadius: ViewStyle = typeof borderRadius === 'number' 
		? { borderRadius } 
		: borderRadius 
			? {
				borderTopLeftRadius: borderRadius.topLeft,
				borderTopRightRadius: borderRadius.topRight,
				borderBottomLeftRadius: borderRadius.bottomLeft,
				borderBottomRightRadius: borderRadius.bottomRight,
			}
			: { borderRadius: 30 };

	return (
		<Pressable style={[styles.root, style]} testID={testID} onPress={onPress}>
			{({ pressed }) => {
				if (Platform.OS === 'ios') {
					return (
						<View style={[styles.container, containerBorderRadius]}>
							<BlurView
								style={styles.absoluteBlur}
								blurType="dark"
								blurAmount={pressed ? 8 : 4}
								reducedTransparencyFallbackColor="rgba(255, 255, 255, 0.15)"
							/>
							<View style={[styles.content, pressed && styles.pressed]}>
								{icon && <SvgXml xml={icon} width={13} height={13} />}
								<BodySSB style={styles.text}>{text}</BodySSB>
							</View>
						</View>
					);
				}
				
				// Android fallback
				return (
					<View style={[styles.blur, containerBorderRadius, pressed && styles.pressed]}>
						{icon && <SvgXml xml={icon} width={13} height={13} />}
						<BodySSB style={styles.text}>{text}</BodySSB>
					</View>
				);
			}}
		</Pressable>
	);
};

const bgColor = Platform.select({
	ios: 'rgba(255, 255, 255, 0.25)',
	android: 'rgba(40, 40, 40, 0.95)',
});

const styles = StyleSheet.create({
	root: {
		height: 56,
		flex: 1,
		shadowColor: 'black',
		shadowOpacity: 0.8,
		shadowRadius: 15,
		shadowOffset: { width: 1, height: 13 },
	},
	container: {
		flex: 1,
		overflow: 'hidden',
	},
	absoluteBlur: {
		position: 'absolute',
		top: 0,
		left: 0,
		right: 0,
		bottom: 0,
	},
	content: {
		flex: 1,
		alignItems: 'center',
		justifyContent: 'center',
		flexDirection: 'row',
		backgroundColor: 'rgba(255, 255, 255, 0.05)',
	},
	blur: {
		flex: 1,
		alignItems: 'center',
		justifyContent: 'center',
		flexDirection: 'row',
		elevation: 6,
		backgroundColor: bgColor,
		overflow: 'hidden',
	},
	text: {
		marginLeft: 6,
	},
	pressed: {
		backgroundColor: 'rgba(255, 255, 255, 0.1)',
	},
});

export default ButtonBlur;
