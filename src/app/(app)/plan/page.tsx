import { redirect } from 'next/navigation';

/** Plan became Areas in V2. Old links keep working. */
export default function PlanRedirect() {
  redirect('/areas');
}
