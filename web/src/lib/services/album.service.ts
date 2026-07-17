import {
  addAssetsToAlbum as addToAlbum,
  addAssetsToAlbums as addToAlbums,
  addUsersToAlbum,
  AlbumUserRole,
  BulkIdErrorReason,
  deleteAlbum,
  getAllAlbums,
  getAuthStatus,
  removeUserFromAlbum,
  // NOTE: `setAlbumLocked` (and its `albumLockDto` param) is the expected generated name for the
  // new `PATCH /albums/:id/lock` endpoint, following this SDK's existing operationId convention
  // (controller method name -> SDK function name). Confirm/adjust after running `mise run
  // open-api-typescript` to regenerate packages/sdk/src/fetch-client.ts from the updated server.
  setAlbumLocked,
  updateAlbumInfo,
  updateAlbumUser,
  type AlbumResponseDto,
  type AlbumsAddAssetsResponseDto,
  type AssetResponseDto,
  type BulkIdResponseDto,
  type UpdateAlbumDto,
  type UserResponseDto,
} from '@immich/sdk';
import { modalManager, toastManager, type ActionItem } from '@immich/ui';
import {
  mdiImageOutline,
  mdiLink,
  mdiLock,
  mdiLockOpenVariant,
  mdiPlus,
  mdiPlusBoxOutline,
  mdiShareVariantOutline,
  mdiUpload,
} from '@mdi/js';
import { type MessageFormatter } from 'svelte-i18n';
import { goto } from '$app/navigation';
import { page } from '$app/state';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { eventManager } from '$lib/managers/event-manager.svelte';
import type { TimelineAsset } from '$lib/managers/timeline-manager/types';
import AlbumAddUsersModal from '$lib/modals/AlbumAddUsersModal.svelte';
import AlbumOptionsModal from '$lib/modals/AlbumOptionsModal.svelte';
import SharedLinkCreateModal from '$lib/modals/SharedLinkCreateModal.svelte';
import { Route } from '$lib/route';
import { createAlbumAndRedirect } from '$lib/utils/album-utils';
import { downloadArchive } from '$lib/utils/asset-utils';
import { openFileUploadDialog } from '$lib/utils/file-uploader';
import { handleError } from '$lib/utils/handle-error';
import { getFormatter } from '$lib/utils/i18n';

export const getAlbumsActions = ($t: MessageFormatter) => {
  const Create: ActionItem = {
    title: $t('create_album'),
    icon: mdiPlusBoxOutline,
    onAction: () => createAlbumAndRedirect(),
  };

  return { Create };
};

export const getAlbumActions = ($t: MessageFormatter, album: AlbumResponseDto) => {
  const isOwned = album.albumUsers[0].user.id === authManager.user.id;

  const Share: ActionItem = {
    title: $t('share'),
    icon: mdiShareVariantOutline,
    $if: () => isOwned,
    onAction: async () => {
      if (await redirectIfLockedAndNotElevated(album)) {
        return;
      }
      modalManager.show(AlbumOptionsModal, { album });
    },
  };

  const AddUsers: ActionItem = {
    title: $t('invite_people'),
    icon: mdiPlus,
    color: 'primary',
    onAction: async () => {
      if (await redirectIfLockedAndNotElevated(album)) {
        return;
      }
      modalManager.show(AlbumAddUsersModal, { album });
    },
  };

  const CreateSharedLink: ActionItem = {
    title: $t('create_link'),
    icon: mdiLink,
    color: 'primary',
    onAction: async () => {
      if (await redirectIfLockedAndNotElevated(album)) {
        return;
      }
      modalManager.show(SharedLinkCreateModal, { albumId: album.id });
    },
  };

  const Lock: ActionItem = {
    title: $t('lock_album'),
    icon: mdiLock,
    $if: () => isOwned && !album.isLocked,
    onAction: () => handleSetAlbumLocked(album, true),
  };

  const Unlock: ActionItem = {
    title: $t('unlock_album'),
    icon: mdiLockOpenVariant,
    $if: () => isOwned && album.isLocked,
    onAction: () => handleSetAlbumLocked(album, false),
  };

  return { Share, AddUsers, CreateSharedLink, Lock, Unlock };
};

export const getAlbumAssetActions = ($t: MessageFormatter, album: AlbumResponseDto, asset: AssetResponseDto) => {
  const SetCover: ActionItem = {
    title: $t('set_as_album_cover'),
    icon: mdiImageOutline,
    onAction: () => handleUpdateThumbnail(album, asset.id),
  };

  return { SetCover };
};

export const getAlbumAssetsActions = ($t: MessageFormatter, album: AlbumResponseDto, assets: TimelineAsset[]) => {
  const AddAssets: ActionItem = {
    title: $t('add_assets'),
    color: 'primary',
    icon: mdiPlusBoxOutline,
    $if: () => assets.length > 0,
    onAction: async () => {
      if (await redirectIfLockedAndNotElevated(album)) {
        return;
      }
      await addAssetsToAlbums(
        [album.id],
        assets.map(({ id }) => id),
        { notify: true },
      );
    },
  };

  const Upload: ActionItem = {
    title: $t('select_from_computer'),
    description: $t('album_upload_assets'),
    icon: mdiUpload,
    onAction: () => void openFileUploadDialog({ albumId: album.id }),
  };

  return { AddAssets, Upload };
};

export const addAssetsToAlbums = async (albumIds: string[], assetIds: string[], { notify }: { notify: boolean }) => {
  const $t = await getFormatter();

  try {
    if (albumIds.length === 1) {
      const albumId = albumIds[0];
      const results = await addToAlbum({ ...authManager.params, id: albumId, bulkIdsDto: { ids: assetIds } });
      if (notify) {
        notifyAddToAlbum($t, albumId, assetIds, results);
      }
    }

    if (albumIds.length > 1) {
      const results = await addToAlbums({ ...authManager.params, albumsAddAssetsDto: { albumIds, assetIds } });
      if (notify) {
        notifyAddToAlbums($t, albumIds, assetIds, results);
      }
    }

    eventManager.emit('AlbumAddAssets', { assetIds, albumIds });
    return true;
  } catch (error) {
    handleError(error, $t('errors.error_adding_assets_to_album'));
    return false;
  }
};

const notifyAddToAlbum = ($t: MessageFormatter, albumId: string, assetIds: string[], results: BulkIdResponseDto[]) => {
  const successCount = results.filter(({ success }) => success).length;
  const duplicateCount = results.filter(({ error }) => error === 'duplicate').length;
  let description = $t('assets_cannot_be_added_to_album_count', { values: { count: assetIds.length } });

  if (duplicateCount === assetIds.length) {
    description = $t('assets_were_part_of_album_count', { values: { count: duplicateCount } });
  } else if (successCount === assetIds.length) {
    description = $t('assets_added_to_album_count', { values: { count: successCount } });
  } else if (successCount > 0) {
    description = $t('assets_added_to_album_partial_count', { values: { successCount, totalCount: assetIds.length } });
  }

  toastManager.primary(
    { description, button: { label: $t('view_album'), onclick: () => goto(Route.viewAlbum({ id: albumId })) } },
    { timeout: 5000 },
  );
};

const notifyAddToAlbums = (
  $t: MessageFormatter,
  albumIds: string[],
  assetIds: string[],
  results: AlbumsAddAssetsResponseDto,
) => {
  if (results.error === BulkIdErrorReason.Duplicate) {
    toastManager.info($t('assets_were_part_of_albums_count', { values: { count: assetIds.length } }));
  } else if (results.error) {
    toastManager.warning($t('assets_cannot_be_added_to_albums', { values: { count: assetIds.length } }));
  } else {
    toastManager.primary(
      $t('assets_added_to_albums_count', {
        values: { albumTotal: albumIds.length, assetTotal: assetIds.length },
      }),
    );
  }
};

export const handleUpdateUserAlbumRole = async ({
  albumId,
  userId,
  role,
}: {
  albumId: string;
  userId: string;
  role: AlbumUserRole;
}) => {
  const $t = await getFormatter();

  try {
    await updateAlbumUser({ id: albumId, userId, updateAlbumUserDto: { role } });
    eventManager.emit('AlbumUserUpdate', { albumId, userId, role });
  } catch (error) {
    handleError(error, $t('errors.unable_to_change_album_user_role'));
  }
};

export const handleAddUsersToAlbum = async (album: AlbumResponseDto, users: UserResponseDto[]) => {
  const $t = await getFormatter();

  try {
    await addUsersToAlbum({ id: album.id, addUsersDto: { albumUsers: users.map(({ id }) => ({ userId: id })) } });
    eventManager.emit('AlbumShare');
    return true;
  } catch (error) {
    handleError(error, $t('errors.error_adding_users_to_album'));
  }
};

export const handleRemoveUserFromAlbum = async (album: AlbumResponseDto, albumUser: UserResponseDto) => {
  const $t = await getFormatter();

  const confirmed = await modalManager.showDialog({
    title: $t('album_remove_user'),
    prompt: $t('album_remove_user_confirmation', { values: { user: albumUser.name } }),
    confirmText: $t('remove_user'),
  });

  if (!confirmed) {
    return;
  }

  try {
    await removeUserFromAlbum({ id: album.id, userId: albumUser.id });
    eventManager.emit('AlbumUserDelete', { albumId: album.id, userId: albumUser.id });
  } catch (error) {
    handleError(error, $t('errors.unable_to_remove_album_users'));
  }
};

const handleUpdateThumbnail = async (album: AlbumResponseDto, assetId: string) => {
  const $t = await getFormatter();

  try {
    const response = await updateAlbumInfo({
      id: album.id,
      updateAlbumDto: {
        albumThumbnailAssetId: assetId,
      },
    });
    eventManager.emit('AlbumUpdate', response);
    toastManager.primary($t('album_cover_updated'));
  } catch (error) {
    handleError(error, $t('errors.unable_to_update_album_cover'));
  }
};

// Query params used on the continue URL to signal a pending lock/unlock action that should
// resume automatically once the PIN prompt elevates the session -- without this, the action was
// silently abandoned after PIN entry, requiring a second manual click. The album ID is carried
// separately since this can be triggered from a page that doesn't have it in its own URL (the
// album list), not just the album detail page.
export const ALBUM_LOCK_RESUME_ACTION_PARAM = 'resumeLockAction';
export const ALBUM_LOCK_RESUME_ALBUM_ID_PARAM = 'resumeLockAlbumId';

// Query param used to reopen the "add to album" picker after a PIN-prompt round trip triggered by
// picking a locked album while not elevated. Unlike lock/unlock, the add itself is never
// auto-resumed -- only the picker UI reopens with the same asset selection, so the user makes a
// fresh, deliberate choice once elevated instead of an add silently firing the moment they enter
// their PIN.
export const ALBUM_ADD_RESUME_ASSET_IDS_PARAM = 'resumeAddAssetIds';

/**
 * Performs the actual lock/unlock API call, with no confirmation dialog and no elevation check.
 * Only call this after the caller has already confirmed the action AND verified the session is
 * elevated -- e.g. from handleSetAlbumLocked below, or when resuming a pending action after the
 * user returns from the PIN prompt page already having confirmed once.
 */
export const applyAlbumLocked = async (album: AlbumResponseDto, isLocked: boolean) => {
  const $t = await getFormatter();
  try {
    const response = await setAlbumLocked({ id: album.id, albumLockDto: { isLocked } });
    eventManager.emit('AlbumUpdate', response);
    toastManager.primary(isLocked ? $t('album_locked') : $t('album_unlocked'));
    return true;
  } catch (error) {
    handleError(error, isLocked ? $t('errors.unable_to_lock_album') : $t('errors.unable_to_unlock_album'));
    return false;
  }
};

export const handleSetAlbumLocked = async (album: AlbumResponseDto, isLocked: boolean) => {
  const $t = await getFormatter();

  // Mirrors the confirmation step SetVisibilityAction.svelte already uses for the single-asset
  // locked-folder toggle -- streamlined to the same UX rather than inventing a new pattern.
  const isConfirmed = await modalManager.showDialog({
    title: isLocked ? $t('lock_album') : $t('unlock_album'),
    prompt: isLocked ? $t('lock_album_confirmation') : $t('unlock_album_confirmation'),
    confirmText: isLocked ? $t('lock') : $t('unlock'),
    confirmColor: isLocked ? 'primary' : 'danger',
    icon: isLocked ? mdiLock : mdiLockOpenVariant,
  });

  if (!isConfirmed) {
    return false;
  }

  // Matches the single-asset locked-folder feature's security model: locking never requires
  // elevation (you're only making something MORE hidden -- just the confirmation above is
  // enough). Unlocking, however, does require the owner's own elevated (PIN-verified) session,
  // since it's what actually reveals previously-hidden content. The server enforces this the same
  // way for both: checkOwnerAccess excludes already-locked items from non-elevated access, so a
  // non-elevated unlock attempt would be rejected there regardless -- this check here just avoids
  // a failed round-trip and gives a proper PIN-prompt redirect instead of a generic error.
  if (!isLocked) {
    const { isElevated } = await getAuthStatus();
    if (!isElevated) {
      // The user already confirmed above -- carry that intent through the PIN prompt via query
      // params on the CURRENT page (album list or album detail, whichever this was triggered from)
      // so the action resumes automatically once elevated, right back where the user was, instead
      // of silently dropping it (requiring a second manual click) or always jumping into the album.
      const continueUrl = new URL(page.url);
      continueUrl.searchParams.set(ALBUM_LOCK_RESUME_ACTION_PARAM, 'unlock');
      continueUrl.searchParams.set(ALBUM_LOCK_RESUME_ALBUM_ID_PARAM, album.id);
      await goto(Route.pinPrompt({ continue: `${continueUrl.pathname}${continueUrl.search}` }));
      return false;
    }
  }

  return applyAlbumLocked(album, isLocked);
};

export const handleUpdateAlbum = async (album: AlbumResponseDto, dto: UpdateAlbumDto) => {
  const $t = await getFormatter();
  const { id } = album;

  if (await redirectIfLockedAndNotElevated(album)) {
    return false;
  }

  try {
    const response = await updateAlbumInfo({ id, updateAlbumDto: dto });
    eventManager.emit('AlbumUpdate', response);
    toastManager.primary({
      description: $t('album_info_updated'),
      button: { label: $t('view_album'), onclick: () => goto(Route.viewAlbum({ id })) },
    });

    return true;
  } catch (error) {
    handleError(error, $t('errors.unable_to_update_album_info'));
  }
};

/**
 * True (and redirects to the PIN prompt) if `album` is locked and the current session isn't
 * elevated -- the server rejects any mutation on a locked album's contents (deleting the album,
 * etc.) in that state, same as it does for viewing/unlocking. Call this before attempting such a
 * mutation to get a proper PIN-prompt redirect instead of a raw "no access" error surfacing from
 * a failed API call.
 *
 * Deliberately does NOT carry the original action through as a resume-after-PIN action (unlike
 * lock/unlock) -- delete is destructive enough that we want the user to land on the album itself
 * and take a fresh, deliberate action once elevated, rather than have a delete silently fire the
 * moment they enter their PIN.
 */
export const redirectIfLockedAndNotElevated = async (album: AlbumResponseDto): Promise<boolean> => {
  if (!album.isLocked || authManager.isElevated) {
    return false;
  }

  const continueUrl = new URL(Route.viewAlbum({ id: album.id }), page.url);
  await goto(Route.pinPrompt({ continue: `${continueUrl.pathname}${continueUrl.search}` }));
  return true;
};

type AlbumSelectionResolution = 'proceed' | 'blocked' | 'redirected';

/**
 * Vets a set of albums picked from the "add to album" picker for `assetIds` before actually
 * adding anything. Mirrors the exclusivity rule `setLocked()` already enforces server-side: a
 * locked asset lives in exactly one album, full stop. So:
 *  - Picking 2+ locked albums together, or mixing a locked album with unlocked ones, is never
 *    valid (elevated or not) -- blocked with a toast, selection is left alone so the user can fix
 *    it themselves.
 *  - Picking a single locked album while not elevated redirects to the PIN prompt and reopens
 *    this same picker (with the same asset selection) on return -- no auto-add.
 *  - Picking a single locked album while elevated is allowed, but if any of the assets already
 *    belong to other albums, those memberships are about to be removed (locking pulls an asset
 *    out of every other album, not just unlocked ones) -- confirm with the user first, naming
 *    every album that will lose the asset(s).
 *  - Any number of unlocked albums together is always fine, no special handling.
 */
export const resolveAlbumSelectionForAdd = async (
  albums: AlbumResponseDto[],
  assetIds: string[],
): Promise<AlbumSelectionResolution> => {
  const $t = await getFormatter();
  const lockedAlbums = albums.filter((album) => album.isLocked);
  const unlockedAlbums = albums.filter((album) => !album.isLocked);

  if (lockedAlbums.length > 1 || (lockedAlbums.length === 1 && unlockedAlbums.length > 0)) {
    toastManager.warning($t('album_add_locked_selection_invalid'));
    return 'blocked';
  }

  if (lockedAlbums.length === 0) {
    return 'proceed';
  }

  const [lockedAlbum] = lockedAlbums;

  if (!authManager.isElevated) {
    const continueUrl = new URL(page.url);
    continueUrl.searchParams.set(ALBUM_ADD_RESUME_ASSET_IDS_PARAM, assetIds.join(','));
    await goto(Route.pinPrompt({ continue: `${continueUrl.pathname}${continueUrl.search}` }));
    return 'redirected';
  }

  const membershipsByAsset = await Promise.all(assetIds.map((assetId) => getAllAlbums({ assetId })));
  const otherAlbumNames = new Set<string>();
  for (const memberships of membershipsByAsset) {
    for (const album of memberships) {
      if (album.id !== lockedAlbum.id) {
        otherAlbumNames.add(album.albumName);
      }
    }
  }

  if (otherAlbumNames.size > 0) {
    const confirmed = await modalManager.showDialog({
      title: $t('album_add_to_locked_confirmation_title'),
      prompt: $t('album_add_to_locked_confirmation', {
        values: { count: assetIds.length, values: [...otherAlbumNames].join(', '), albumName: lockedAlbum.albumName },
      }),
      confirmText: $t('add'),
      confirmColor: 'primary',
      icon: mdiLock,
    });

    if (!confirmed) {
      return 'blocked';
    }
  }

  return 'proceed';
};

export const handleDeleteAlbum = async (album: AlbumResponseDto, options?: { prompt?: boolean; notify?: boolean }) => {
  const $t = await getFormatter();
  const { prompt = true, notify = true } = options ?? {};

  if (await redirectIfLockedAndNotElevated(album)) {
    return false;
  }

  if (prompt) {
    const confirmation =
      album.albumName.length > 0
        ? $t('album_delete_confirmation', { values: { album: album.albumName } })
        : $t('unnamed_album_delete_confirmation');
    const description = $t('album_delete_confirmation_description');
    const success = await modalManager.showDialog({ prompt: `${confirmation} ${description}` });
    if (!success) {
      return false;
    }
  }

  try {
    await deleteAlbum({ id: album.id });
    eventManager.emit('AlbumDelete', album);
    if (notify) {
      toastManager.primary();
    }
    return true;
  } catch (error) {
    handleError(error, $t('errors.unable_to_delete_album'), { notify });
    return false;
  }
};

export const handleDownloadAlbum = async (album: AlbumResponseDto) => {
  if (await redirectIfLockedAndNotElevated(album)) {
    return;
  }

  await downloadArchive(`${album.albumName}.zip`, { albumId: album.id });
};

export const handleConfirmAlbumDelete = async (album: AlbumResponseDto) => {
  const $t = await getFormatter();
  const confirmation =
    album.albumName.length > 0
      ? $t('album_delete_confirmation', { values: { album: album.albumName } })
      : $t('unnamed_album_delete_confirmation');

  const description = $t('album_delete_confirmation_description');
  const prompt = `${confirmation} ${description}`;

  return modalManager.showDialog({ prompt });
};
