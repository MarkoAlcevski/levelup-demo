import { redirect } from 'next/navigation';

/** Reviews became Reports in V2. Old links keep working. */
export default function ReviewsRedirect() {
  redirect('/progress/reports');
}
