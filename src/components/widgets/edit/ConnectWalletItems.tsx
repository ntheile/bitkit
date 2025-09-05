import { useTranslation } from 'react-i18next';
import { TConnectWalletWidgetOptions } from '../../../store/types/widgets';
import { BodySSB, Title } from '../../../styles/text';
import { EWidgetItemType, TWidgetItem } from './types';

export const getConnectWalletItems = (
	options: TConnectWalletWidgetOptions,
): TWidgetItem[] => {
	const { t } = useTranslation('widgets');

	return [
		{
			key: 'showTitle',
			type: EWidgetItemType.static,
			title: <Title>{t('connectwallet.title')}</Title>,
			isChecked: true,
		},
		{
			key: 'showInstructions',
			type: EWidgetItemType.toggle,
			title: t('connectwallet.instructions'),
			value: (
				<BodySSB color="secondary" numberOfLines={2}>
					{t('connectwallet.instructions')}
				</BodySSB>
			),
			isChecked: options.showInstructions,
		},
		{
			key: 'showWalletSelector',
			type: EWidgetItemType.toggle,
			title: t('connectwallet.wallet_selector'),
			value: (
				<BodySSB color="secondary" numberOfLines={1}>
					{t('connectwallet.wallet_selector')}
				</BodySSB>
			),
			isChecked: options.showWalletSelector,
		},
		{
			key: 'showConnectionForm',
			type: EWidgetItemType.toggle,
			title: t('connectwallet.connection_form'),
			value: (
				<BodySSB color="secondary" numberOfLines={1}>
					{t('connectwallet.connection_form')}
				</BodySSB>
			),
			isChecked: options.showConnectionForm,
		},
		{
			key: 'showSource',
			type: EWidgetItemType.toggle,
			title: t('widget.source'),
			value: (
				<BodySSB color="secondary" numberOfLines={1} ellipsizeMode="middle">
					Bitkit
				</BodySSB>
			),
			isChecked: options.showSource,
		},
	];
};
