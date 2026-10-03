import { redirect } from 'next/navigation';

/** You became Profile (behind the avatar) in V2. Old links keep working. */
export default function YouRedirect() {
  redirect('/profile');
}
