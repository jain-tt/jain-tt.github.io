from anomaly import burn_rate, robust_z, should_page


def test_detects_single_burst_without_masking():
    vals = [1.0, 1.1, 0.9, 1.0, 1.05, 0.95] * 5 + [9.0] + [1.0] * 5
    assert [i for i, _ in robust_z(vals, window=12)] == [30]


def test_burn_rate():
    assert round(burn_rate(0.0144, 0.999), 1) == 14.4
    assert should_page(0.02, 0.02, 0.999, 14.4) and not should_page(0.02, 0.001, 0.999, 14.4)
