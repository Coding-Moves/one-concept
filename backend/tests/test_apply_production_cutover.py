"""Production SQL runner guards; these tests never open a database connection."""

import os
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from tools import apply_production_cutover as cutover


class ProductionCutoverTests(unittest.TestCase):
    def test_reviewed_range_is_exact(self):
        files = cutover.pending_files()
        self.assertEqual(len(files), 85)
        self.assertEqual(files[0].name, "0046_supabase_api_basics.sql")
        self.assertEqual(files[-1].name, cutover.FINAL)

    def test_connection_must_name_fixed_production_project(self):
        base = {
            "PRODUCTION_PROJECT_REF": cutover.PRODUCTION_REF,
            "STAGING_PROJECT_REF": cutover.STAGING_REF,
            "PRODUCTION_SCHEMA_DIRECT_URL":
                "postgresql://postgres.egdszjoesxlccauahmsx:fake@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres",
        }
        with patch.dict(os.environ, base):
            env = cutover.target_environment()
            self.assertEqual(env["PGUSER"], "postgres." + cutover.PRODUCTION_REF)
            self.assertNotIn("PRODUCTION_SCHEMA_DIRECT_URL", env)
        with patch.dict(os.environ, {**base, "PRODUCTION_SCHEMA_DIRECT_URL":
                base["PRODUCTION_SCHEMA_DIRECT_URL"].replace(cutover.PRODUCTION_REF, cutover.STAGING_REF)}):
            with self.assertRaises(ValueError):
                cutover.target_environment()
        with patch.dict(os.environ, {**base, "PRODUCTION_PROJECT_REF": cutover.STAGING_REF}):
            with self.assertRaises(ValueError):
                cutover.target_environment()

    def test_apply_refuses_without_backup_and_exact_confirmation(self):
        with patch.dict(os.environ, {}, clear=True), \
             patch.object(cutover, "pending_files", return_value=[Path("0046.sql")]), \
             patch.object(cutover, "target_environment", return_value={}), \
             patch.object(cutover, "baseline_ready", return_value=True), \
             patch.object(cutover, "psql") as psql, \
             patch("sys.argv", ["runner", "--apply"]):
            self.assertEqual(cutover.main(), 2)
            psql.assert_not_called()

    def test_partial_failure_stops_before_next_file(self):
        first, second = Path("0046.sql"), Path("0047.sql")
        env = {
            "PRODUCTION_BACKUP_REFERENCE": "backup-2026-10-21",
            "PRODUCTION_APPLY_CONFIRMATION":
                "apply-0046-through-0130-to-" + cutover.PRODUCTION_REF,
        }
        with patch.dict(os.environ, env), \
             patch.object(cutover, "pending_files", return_value=[first, second]), \
             patch.object(cutover, "target_environment", return_value={}), \
             patch.object(cutover, "baseline_ready", return_value=True), \
             patch.object(cutover, "psql", return_value=SimpleNamespace(returncode=1)) as psql, \
             patch("sys.argv", ["runner", "--apply"]):
            self.assertEqual(cutover.main(), 1)
            psql.assert_called_once()
            self.assertEqual(psql.call_args.args[-1], str(first))


if __name__ == "__main__":
    unittest.main()
