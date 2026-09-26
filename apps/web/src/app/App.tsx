import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { RouterProvider } from 'react-router';
import { createAppRouter } from './router';

export function App() {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: 1 } } }),
  );
  const [router] = useState(createAppRouter);
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
