import TabRedirect from '@/components/TabRedirect';

// Old address for the chat inbox: the Messages view of the Activity tab on the Dashboard.
export default function Page() {
  return <TabRedirect tab="activity" hash="#messages" />;
}
