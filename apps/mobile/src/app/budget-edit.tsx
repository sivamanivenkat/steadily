import { isCategoryId } from '@steadily/taxonomy';
import { useLocalSearchParams } from 'expo-router';

import { BudgetEditScreen } from '@/screens/BudgetEditScreen';

/** `categoryId`: a category id, `overall` for the monthly budget, or absent for a new budget. */
export default function BudgetEditRoute() {
  const { categoryId } = useLocalSearchParams<{ categoryId?: string }>();
  const initial =
    categoryId === 'overall'
      ? null
      : categoryId !== undefined && isCategoryId(categoryId)
        ? categoryId
        : undefined;
  return <BudgetEditScreen {...(initial !== undefined ? { initialCategoryId: initial } : {})} />;
}
