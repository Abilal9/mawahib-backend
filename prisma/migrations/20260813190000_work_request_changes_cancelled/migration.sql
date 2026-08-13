-- Proposer can retract an outstanding change request without closing the WR.
ALTER TYPE "WorkRequestEventType" ADD VALUE 'changes_cancelled';
