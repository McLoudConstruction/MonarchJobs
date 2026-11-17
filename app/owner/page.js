import TabRedirect from '@/components/TabRedirect';

// Moved: the owner reports are now Dashboard tabs (Overview, Financials, Jobs & Leads, Customers). TabRedirect sends an old #section to its tab.
export default function Page() {
  return <TabRedirect tab="owner" />;
}
