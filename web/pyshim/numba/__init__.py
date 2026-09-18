"""Stand-in for Numba, used only by the browser build (Pyodide has no Numba).

The model's @njit functions are plain NumPy code, so running them uncompiled
gives the same results (to solver tolerance) at similar speed for a single
fixed-schedule run. The desktop application keeps using the real Numba.
"""


def njit(*args, **kwargs):
    if len(args) == 1 and callable(args[0]) and not kwargs:
        return args[0]

    def decorator(func):
        return func

    return decorator


jit = njit


class _Type:
    def __getitem__(self, _):
        return self

    def __call__(self, *args, **kwargs):
        return self


class _Types:
    def __getattr__(self, name):
        return _Type()


types = _Types()
