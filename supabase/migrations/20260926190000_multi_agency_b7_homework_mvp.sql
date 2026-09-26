-- =============================================================================
-- Migration: 20260926190000_multi_agency_b7_homework_mvp.sql
-- Description: Minimal tenant homework MVP schema, composite constraints, and RLS policies
-- Milestone: B7 (Multi-Surface UI Variant Engine & Minimal Homework MVP)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.agency_homework_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id UUID NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
    membership_id UUID NOT NULL,
    canonical_course_id UUID NOT NULL REFERENCES public.canonical_courses(id) ON DELETE CASCADE,
    lesson_id TEXT NOT NULL,
    submission_title TEXT NOT NULL,
    submission_content JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('draft', 'submitted', 'in_review', 'evaluated', 'rejected')),
    staff_feedback TEXT,
    staff_score NUMERIC(4,1),
    reviewed_by_membership_id UUID,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_homework_membership FOREIGN KEY (agency_id, membership_id) REFERENCES public.agency_memberships(agency_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_homework_reviewer FOREIGN KEY (agency_id, reviewed_by_membership_id) REFERENCES public.agency_memberships(agency_id, id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_homework_agency_membership ON public.agency_homework_submissions(agency_id, membership_id);
CREATE INDEX IF NOT EXISTS idx_homework_agency_course ON public.agency_homework_submissions(agency_id, canonical_course_id);
CREATE INDEX IF NOT EXISTS idx_homework_agency_status ON public.agency_homework_submissions(agency_id, status);

ALTER TABLE public.agency_homework_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_homework_submissions FORCE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- RLS POLICIES FOR agency_homework_submissions
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS tenant_select_homework ON public.agency_homework_submissions;
CREATE POLICY tenant_select_homework ON public.agency_homework_submissions
    FOR SELECT USING (
        agency_id = public.current_agency_id() AND (
            membership_id IN (
                SELECT id FROM public.agency_memberships
                WHERE user_id = auth.uid() AND agency_id = public.current_agency_id()
            )
            OR EXISTS (
                SELECT 1 FROM public.agency_memberships
                WHERE user_id = auth.uid() AND agency_id = public.current_agency_id() AND role IN ('agency_staff', 'agency_owner')
            )
        )
    );

DROP POLICY IF EXISTS tenant_insert_homework ON public.agency_homework_submissions;
CREATE POLICY tenant_insert_homework ON public.agency_homework_submissions
    FOR INSERT WITH CHECK (
        agency_id = public.current_agency_id() AND
        membership_id IN (
            SELECT id FROM public.agency_memberships
            WHERE user_id = auth.uid() AND agency_id = public.current_agency_id() AND status = 'active'
        )
    );

DROP POLICY IF EXISTS tenant_update_homework ON public.agency_homework_submissions;
CREATE POLICY tenant_update_homework ON public.agency_homework_submissions
    FOR UPDATE USING (
        agency_id = public.current_agency_id() AND (
            (
                membership_id IN (
                    SELECT id FROM public.agency_memberships
                    WHERE user_id = auth.uid() AND agency_id = public.current_agency_id() AND status = 'active'
                )
                AND status IN ('draft', 'submitted')
            )
            OR EXISTS (
                SELECT 1 FROM public.agency_memberships
                WHERE user_id = auth.uid() AND agency_id = public.current_agency_id() AND role IN ('agency_staff', 'agency_owner')
            )
        )
    );

-- -----------------------------------------------------------------------------
-- RPC: submit_agency_homework
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_agency_homework(
    p_agency_id UUID,
    p_membership_id UUID,
    p_canonical_course_id UUID,
    p_lesson_id TEXT,
    p_title TEXT,
    p_content JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_has_entitlement BOOLEAN;
    v_submission_id UUID;
BEGIN
    -- Verify active entitlement in current agency
    SELECT EXISTS (
        SELECT 1 FROM public.student_entitlements
        WHERE agency_id = p_agency_id
          AND membership_id = p_membership_id
          AND canonical_course_id = p_canonical_course_id
          AND status = 'active'
          AND (expires_at IS NULL OR expires_at > now())
    ) INTO v_has_entitlement;

    IF NOT v_has_entitlement THEN
        RETURN jsonb_build_object('success', false, 'code', 'entitlement_required');
    END IF;

    INSERT INTO public.agency_homework_submissions (
        agency_id,
        membership_id,
        canonical_course_id,
        lesson_id,
        submission_title,
        submission_content,
        status
    ) VALUES (
        p_agency_id,
        p_membership_id,
        p_canonical_course_id,
        p_lesson_id,
        p_title,
        COALESCE(p_content, '{}'::jsonb),
        'submitted'
    ) RETURNING id INTO v_submission_id;

    RETURN jsonb_build_object(
        'success', true,
        'submission_id', v_submission_id,
        'status', 'submitted'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_agency_homework(UUID, UUID, UUID, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_agency_homework(UUID, UUID, UUID, TEXT, TEXT, JSONB) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- RPC: grade_agency_homework
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.grade_agency_homework(
    p_agency_id UUID,
    p_staff_membership_id UUID,
    p_submission_id UUID,
    p_status TEXT,
    p_feedback TEXT,
    p_score NUMERIC
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_is_staff BOOLEAN;
    v_updated_count INT;
BEGIN
    -- Verify reviewer is staff/owner in this agency
    SELECT EXISTS (
        SELECT 1 FROM public.agency_memberships
        WHERE id = p_staff_membership_id
          AND agency_id = p_agency_id
          AND role IN ('agency_staff', 'agency_owner')
          AND status = 'active'
    ) INTO v_is_staff;

    IF NOT v_is_staff THEN
        RETURN jsonb_build_object('success', false, 'code', 'staff_role_required');
    END IF;

    UPDATE public.agency_homework_submissions
    SET
        status = p_status,
        staff_feedback = p_feedback,
        staff_score = p_score,
        reviewed_by_membership_id = p_staff_membership_id,
        reviewed_at = now(),
        updated_at = now()
    WHERE id = p_submission_id
      AND agency_id = p_agency_id;

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;

    IF v_updated_count = 0 THEN
        RETURN jsonb_build_object('success', false, 'code', 'submission_not_found');
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'submission_id', p_submission_id,
        'status', p_status
    );
END;
$$;

REVOKE ALL ON FUNCTION public.grade_agency_homework(UUID, UUID, UUID, TEXT, TEXT, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.grade_agency_homework(UUID, UUID, UUID, TEXT, TEXT, NUMERIC) TO authenticated, service_role;
