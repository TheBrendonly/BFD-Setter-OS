-- F6 (security review 2026-06-05): the prompt-chat tables are read directly by the
-- browser with the anon/publishable key, so RLS is the only tenant boundary. They
-- previously had permissive `USING (true)` policies for the `authenticated` role,
-- letting any logged-in user read/write every tenant's prompt-builder chat threads
-- and messages. Replace with agency/client-scoped policies that mirror the existing
-- `clients` table RLS. Service-role edge functions bypass RLS and are unaffected.

-- prompt_chat_threads: scope by the thread's client_id ownership.
DROP POLICY IF EXISTS "prompt_chat_threads_all_authenticated" ON public.prompt_chat_threads;
CREATE POLICY "prompt_chat_threads_tenant_scoped" ON public.prompt_chat_threads
  FOR ALL TO authenticated
  USING (
    client_id IN (
      SELECT c.id FROM public.clients c
      JOIN public.profiles p ON p.id = auth.uid()
      WHERE c.agency_id = p.agency_id OR c.id = p.client_id
    )
  )
  WITH CHECK (
    client_id IN (
      SELECT c.id FROM public.clients c
      JOIN public.profiles p ON p.id = auth.uid()
      WHERE c.agency_id = p.agency_id OR c.id = p.client_id
    )
  );

-- prompt_chat_messages: no client_id column; scope via the parent thread, which is
-- itself tenant-scoped by the policy above (RLS applies to the subquery).
DROP POLICY IF EXISTS "prompt_chat_messages_all_authenticated" ON public.prompt_chat_messages;
CREATE POLICY "prompt_chat_messages_via_thread" ON public.prompt_chat_messages
  FOR ALL TO authenticated
  USING (
    thread_id IN (SELECT id FROM public.prompt_chat_threads)
  )
  WITH CHECK (
    thread_id IN (SELECT id FROM public.prompt_chat_threads)
  );
