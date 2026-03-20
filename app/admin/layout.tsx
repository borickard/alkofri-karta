import { Suspense } from 'react';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <Suspense>{children}</Suspense>;
}
