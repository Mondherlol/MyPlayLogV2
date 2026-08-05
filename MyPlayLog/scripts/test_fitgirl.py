import asyncio
from fitgirl import FitGirlClient

async def main():
    # Context manager handles session cleanup automatically
    async with FitGirlClient() as client:
        
        # 1. Search for a game (Uses API for speed)
        print("🔍 Searching for 'Cyberpunk'...")
        results = await client.search_api("cyberpunk")
        
        for post in results.items:
            print(f"found: {post.title}")

        # 2. Get Deep Details
        slug = "cyberpunk-2077"
        print(f"\n📥 Fetching details for {slug}...")
        repack = await client.get_repack_api(slug)
        
        print(f"📦 Size: {repack.repack_size}")
        print(f"🧲 Magnet: {repack.torrent_sources[0].magnet.raw_uri[:60]}...")
        
        # 3. Check Real-time Health
        health = await client.check_magnet_health(repack.torrent_sources[0].magnet)
        if health:
            print(f"🟢 Seeds: {health.seeds} | 🔴 Peers: {health.peers}")

if __name__ == "__main__":
    asyncio.run(main())