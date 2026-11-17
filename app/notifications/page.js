import TabRedirect from '@/components/TabRedirect';

// Old address for the notifications list; it is the Activity tab on the Dashboard now.
export default function Page() {
  return <TabRedirect tab="activity" />;
}
