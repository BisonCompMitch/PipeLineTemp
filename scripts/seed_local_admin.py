import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Create or refresh the local BisonWorks admin login.")
    parser.add_argument("--username", default="admin")
    parser.add_argument("--password", required=True)
    parser.add_argument("--email", default="admin@local.test")
    parser.add_argument("--full-name", default="Local Admin")
    args = parser.parse_args()

    backend_root = Path.cwd()
    if str(backend_root) not in sys.path:
        sys.path.insert(0, str(backend_root))

    from app.main import (  # pylint: disable=import-outside-toplevel
        HAS_USERS_LOGIN_USERNAME,
        SessionLocal,
        UserModel,
        _set_bcrypt_password,
        ensure_schema,
        init_db,
    )

    init_db()
    ensure_schema()

    db = SessionLocal()
    try:
        user = db.query(UserModel).filter(UserModel.username == args.username).first()
        created = user is None

        if user is None:
            values = {
                "username": args.username,
                "email": args.email,
                "full_name": args.full_name,
                "roles": ["admin"],
                "areas": ["Admin", "Management"],
                "must_reset_password": False,
                "password_hash": "",
                "password_salt": "",
                "password_algorithm": "",
                "password_iterations": 0,
                "created_at": datetime.now(timezone.utc),
            }
            if HAS_USERS_LOGIN_USERNAME:
                values["login_username"] = args.username
            user = UserModel(**values)
            db.add(user)
        else:
            user.email = args.email
            user.full_name = args.full_name
            user.roles = ["admin"]
            user.areas = ["Admin", "Management"]
            user.must_reset_password = False
            if HAS_USERS_LOGIN_USERNAME:
                user.login_username = args.username

        _set_bcrypt_password(user, args.password)
        db.commit()

        action = "Created" if created else "Refreshed"
        print(f"{action} local admin user: {args.username} / {args.password}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
