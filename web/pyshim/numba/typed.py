class Dict(dict):
    """numba.typed.Dict stand-in: an ordinary dict."""

    @classmethod
    def empty(cls, key_type=None, value_type=None):
        return cls()
