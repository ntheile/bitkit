import { BottomSheetModal } from '@gorhom/bottom-sheet';
import { RefObject } from 'react';
import { SheetId } from '../store/types/ui';

type SheetRef = {
	id: SheetId;
	ref: RefObject<BottomSheetModal | null>;
};

/**
 * Helper function to check if a sheet is currently open
 * @param ref Sheet reference
 * @returns true if the sheet is open, false otherwise
 */
const isSheetOpen = (ref: RefObject<BottomSheetModal | null>): boolean => {
	try {
		const modal = ref.current;
		if (!modal) return false;
		// @ts-ignore - animatedIndex exists but may not be in types
		const index = modal.animatedIndex?.value;
		return typeof index === 'number' && index >= 0;
	} catch {
		return false;
	}
};

/**
 * Utility function to check if any bottom sheet is currently open
 * @param sheetRefs Array of sheet references from useAllSheetRefs()
 * @returns true if any sheet is open, false otherwise
 */
export const isAnySheetOpen = (sheetRefs: SheetRef[]): boolean => {
	return sheetRefs.some(({ ref }) => isSheetOpen(ref));
};

/**
 * Utility function to get all currently open bottom sheets
 * @param sheetRefs Array of sheet references from useAllSheetRefs()
 * @returns Array of open sheet references
 */
export const getOpenSheets = (sheetRefs: SheetRef[]): SheetRef[] => {
	return sheetRefs.filter(({ ref }) => isSheetOpen(ref));
};
