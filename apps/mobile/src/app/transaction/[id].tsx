import { useLocalSearchParams } from 'expo-router';

import { TransactionDetailScreen } from '@/screens/TransactionDetailScreen';

export default function TransactionRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <TransactionDetailScreen id={id ?? ''} />;
}
