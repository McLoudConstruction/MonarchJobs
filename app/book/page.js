import BookingFlow from '@/components/booking/BookingFlow';

export const metadata = { title: 'Book an appointment' };

// Public booking page. No sign-in needed: customers use it from a link we send them. Staff who are signed in see more
// (every price-list item, any kind of job, "schedule later"), so it works for booking in person too.
export default function BookPage() {
  return <BookingFlow />;
}
