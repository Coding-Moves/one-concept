"""Protected Cron runner target and inactive-readback guards."""

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from tools import install_production_cron as cron


class InstallProductionCronTests(unittest.TestCase):
    def test_invalid_target_cannot_run_installer(self):
        with patch.object(cron, "target_environment", side_effect=ValueError), \
             patch.object(cron, "psql") as psql, \
             patch("sys.argv", ["installer", "--install"]):
            self.assertEqual(cron.main(), 2)
            psql.assert_not_called()

    def test_missing_worker_schema_cannot_run_installer(self):
        with patch.object(cron, "target_environment", return_value={}), \
             patch.object(cron, "query_is_true", return_value=False), \
             patch.object(cron, "psql") as psql, \
             patch("sys.argv", ["installer", "--install"]):
            self.assertEqual(cron.main(), 2)
            psql.assert_not_called()

    def test_install_requires_inactive_readback(self):
        with patch.object(cron, "target_environment", return_value={}), \
             patch.object(cron, "query_is_true", return_value=True), \
             patch.object(cron, "psql", return_value=SimpleNamespace(returncode=0)) as psql, \
             patch.object(cron, "installed_inactive", return_value=False), \
             patch("sys.argv", ["installer", "--install"]):
            self.assertEqual(cron.main(), 1)
            self.assertEqual(psql.call_args.args[-1], str(cron.INSTALLER))

    def test_expected_names_and_inactive_state_are_checked(self):
        with patch.object(cron, "query_is_true", return_value=True) as query:
            self.assertTrue(cron.installed_inactive({}))
            sql = query.call_args.args[1]
            self.assertIn("count(*) = 8", sql)
            self.assertIn("count(*) filter (where active) = 0", sql)
            for name in cron.EXPECTED_JOBS:
                self.assertIn(name, sql)


if __name__ == "__main__":
    unittest.main()
