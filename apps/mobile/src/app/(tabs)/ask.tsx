import { OnDeviceBadge, PlaceholderScreen } from '@/components';

export default function AskScreen() {
  return (
    <PlaceholderScreen
      title="Ask"
      heading="Ask about your money"
      body="Questions like “How much did I spend on dining this month?” are answered on this phone."
      footer={<OnDeviceBadge />}
    />
  );
}
